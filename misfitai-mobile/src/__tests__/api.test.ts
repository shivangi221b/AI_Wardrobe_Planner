import {
  ApiError,
  isApiError,
  getApiErrorMessage,
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
