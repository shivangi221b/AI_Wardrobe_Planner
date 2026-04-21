import {
  ApiError,
  isApiError,
  getApiErrorMessage,
  profileUpdateToApiPayload,
  API_BASE_URL,
} from '../api';

// ------------------------------------------------------------------
// ApiError class
// ------------------------------------------------------------------

describe('ApiError', () => {
  it('carries status and body', () => {
    const err = new ApiError('fail', 404, '{"detail":"not found"}');
    expect(err.status).toBe(404);
    expect(err.body).toBe('{"detail":"not found"}');
    expect(err.name).toBe('ApiError');
  });

  it('is an instance of Error', () => {
    const err = new ApiError('fail', 500, 'server error');
    expect(err).toBeInstanceOf(Error);
  });
});

// ------------------------------------------------------------------
// isApiError
// ------------------------------------------------------------------

describe('isApiError', () => {
  it('returns true for ApiError', () => {
    expect(isApiError(new ApiError('x', 400, ''))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isApiError(new Error('x'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError('string')).toBe(false);
    expect(isApiError(42)).toBe(false);
  });
});

// ------------------------------------------------------------------
// getApiErrorMessage
// ------------------------------------------------------------------

describe('getApiErrorMessage', () => {
  it('extracts detail from JSON body', () => {
    const err = new ApiError('fail', 422, '{"detail":"Invalid input"}');
    expect(getApiErrorMessage(err, 'fallback')).toBe('Invalid input');
  });

  it('falls back with status when body is not JSON', () => {
    const err = new ApiError('fail', 500, 'Internal Server Error');
    expect(getApiErrorMessage(err, 'Something broke')).toBe('Something broke (500)');
  });

  it('returns fallback for non-ApiError', () => {
    expect(getApiErrorMessage(new Error('oops'), 'default msg')).toBe('default msg');
  });

  it('returns fallback when detail is empty', () => {
    const err = new ApiError('fail', 400, '{"detail":"  "}');
    expect(getApiErrorMessage(err, 'fallback')).toBe('fallback (400)');
  });
});

// ------------------------------------------------------------------
// API_BASE_URL
// ------------------------------------------------------------------

describe('API_BASE_URL', () => {
  it('is defined and does not end with a slash', () => {
    expect(typeof API_BASE_URL).toBe('string');
    expect(API_BASE_URL).not.toMatch(/\/$/);
  });
});

// ------------------------------------------------------------------
// Mock API functions (testing fetch mock)
// ------------------------------------------------------------------

describe('getWardrobe (mock mode)', () => {
  // The module defaults to USE_MOCK_API = true in __DEV__ / test env
  it('returns an array of garments', async () => {
    const { getWardrobe } = require('../api');
    const result = await getWardrobe('test-user');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('category');
  });
});

describe('addGarment (mock mode)', () => {
  it('adds a garment and returns it', async () => {
    const { addGarment } = require('../api');
    const garment = await addGarment('test-user', {
      name: 'Test shirt',
      category: 'top',
      color: 'blue',
    });
    expect(garment).toHaveProperty('id');
    expect(garment.name).toBe('Test shirt');
    expect(garment.category).toBe('top');
  });
});

describe('saveWeekEvents (mock mode)', () => {
  it('persists and returns events', async () => {
    const { saveWeekEvents } = require('../api');
    const result = await saveWeekEvents('test-user', [
      { id: 'e1', day: 'monday', eventType: 'gym' },
    ]);
    expect(result.events).toBeDefined();
    expect(Array.isArray(result.events)).toBe(true);
  });
});

describe('getWeeklyRecommendations (mock mode)', () => {
  it('returns recommendations for events', async () => {
    const { getWeeklyRecommendations } = require('../api');
    const result = await getWeeklyRecommendations('test-user', [
      { id: 'e1', day: 'monday', eventType: 'work_meeting' },
      { id: 'e2', day: 'tuesday', eventType: 'casual' },
    ]);
    expect(result.recommendations).toBeDefined();
    expect(result.recommendations.length).toBe(2);
    expect(result.recommendations[0]).toHaveProperty('day');
    expect(result.recommendations[0]).toHaveProperty('outfit');
    expect(result.recommendations[0]).toHaveProperty('explanation');
  });
});

describe('searchGarmentImages (mock mode)', () => {
  it('returns results for a query', async () => {
    const { searchGarmentImages } = require('../api');
    const results = await searchGarmentImages('test-user', 'black shirt');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('imageUrl');
  });

  it('returns empty for blank query', async () => {
    const { searchGarmentImages } = require('../api');
    const results = await searchGarmentImages('test-user', '');
    expect(results).toEqual([]);
  });
});

// ------------------------------------------------------------------
// getUserProfile (mock mode)
// ------------------------------------------------------------------

describe('getUserProfile (mock mode)', () => {
  it('returns null for an unknown user id', async () => {
    const { getUserProfile } = require('../api');
    const result = await getUserProfile('unknown-user');
    // Mock mode has no stored data — should return null.
    expect(result).toBeNull();
  });
});

// ------------------------------------------------------------------
// updateUserProfile (mock mode)
// ------------------------------------------------------------------

describe('updateUserProfile (mock mode)', () => {
  it('returns a UserProfile shaped object', async () => {
    const { updateUserProfile } = require('../api');
    const result = await updateUserProfile('test-user', { gender: 'female' });
    expect(result).toHaveProperty('userId');
    expect(result).toHaveProperty('favoriteColors');
    expect(Array.isArray(result.favoriteColors)).toBe(true);
  });
});

// ------------------------------------------------------------------
// profileUpdateToApiPayload — camelCase → snake_case mapping
// ------------------------------------------------------------------

describe('profileUpdateToApiPayload', () => {
  it('maps camelCase to snake_case', () => {
    const payload = profileUpdateToApiPayload({
      skinTone: 'medium',
      colorTone: 'warm',
      favoriteColors: ['blue'],
      avoidedColors: ['red'],
      shoeSize: '42',
      topSize: 'M',
      bottomSize: 'L',
    });
    expect(payload.skin_tone).toBe('medium');
    expect(payload.color_tone).toBe('warm');
    expect(payload.favorite_colors).toEqual(['blue']);
    expect(payload.avoided_colors).toEqual(['red']);
    expect(payload.shoe_size).toBe('42');
    expect(payload.top_size).toBe('M');
    expect(payload.bottom_size).toBe('L');
  });

  it('omits keys not provided', () => {
    const payload = profileUpdateToApiPayload({ gender: 'male' });
    expect(payload.gender).toBe('male');
    expect('skin_tone' in payload).toBe(false);
    expect('avatar_config' in payload).toBe(false);
  });

  it('serialises avatarConfig object to snake_case keys', () => {
    const payload = profileUpdateToApiPayload({
      avatarConfig: {
        hairStyle: 'long_straight',
        hairColor: 'black',
        bodyType: 'slim',
        skinTone: 'medium_dark',
        avatarImageUrl: 'https://example.com/av.jpg',
      },
    });
    const cfg = payload.avatar_config as Record<string, unknown>;
    expect(cfg).not.toBeNull();
    expect(cfg.hair_style).toBe('long_straight');
    expect(cfg.hair_color).toBe('black');
    expect(cfg.body_type).toBe('slim');
    expect(cfg.skin_tone).toBe('medium_dark');
    expect(cfg.avatar_image_url).toBe('https://example.com/av.jpg');
  });

  it('sends avatar_config: null when avatarConfig is explicitly null', () => {
    const payload = profileUpdateToApiPayload({ avatarConfig: null });
    expect('avatar_config' in payload).toBe(true);
    expect(payload.avatar_config).toBeNull();
  });

  it('does not include avatar_config when avatarConfig is undefined', () => {
    const payload = profileUpdateToApiPayload({ gender: 'other' });
    expect('avatar_config' in payload).toBe(false);
  });
});
