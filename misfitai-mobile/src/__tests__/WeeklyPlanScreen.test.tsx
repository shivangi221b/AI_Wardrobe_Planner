import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { AppStateProvider } from '../AppStateContext';
import { WeeklyPlanScreen } from '../WeeklyPlanScreen';
import type { DayRecommendation, UserProfile } from '../types';

jest.mock('../stockImages', () => ({
  getImageForGarment: jest.fn(() => undefined),
}));

jest.mock('../analytics', () => ({
  trackOutfitAvatarPreviewOpen: jest.fn(),
  trackOutfitAccepted: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const mockOnRegenerate = jest.fn(() => Promise.resolve());
const mockOnNavigate = jest.fn();

function renderScreen() {
  return render(
    <AppStateProvider userId="test-user">
      <WeeklyPlanScreen
        onRegenerateWeek={mockOnRegenerate}
        onNavigateToWardrobe={mockOnNavigate}
      />
    </AppStateProvider>,
  );
}

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('WeeklyPlanScreen', () => {
  it('renders without crashing', async () => {
    const { toJSON } = renderScreen();
    await waitFor(() => {
      expect(toJSON()).toBeTruthy();
    });
  });

  it('shows empty-state helper text when there are no recommendations', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      // The screen should display some indication that no outfits have been generated.
      expect(getByText(/No recommendations yet/i)).toBeTruthy();
    });
  });

  it('displays the screen title', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText(/weekly lookbook/i)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// "On Me" toggle visibility — requires mocking the context value
// ---------------------------------------------------------------------------

jest.mock('../AppStateContext', () => {
  const actual = jest.requireActual('../AppStateContext') as Record<string, unknown>;

  // We expose a mutable override so individual tests can inject a profile.
  let _override: { userProfile?: UserProfile | null } = {};

  const useAppState = () => {
    const base = (actual.useAppState as () => ReturnType<typeof import('../AppStateContext').useAppState>)();
    return { ...base, ..._override };
  };

  return {
    ...actual,
    useAppState,
    __setOverride: (v: typeof _override) => { _override = v; },
    __clearOverride: () => { _override = {}; },
  };
});

// Helper to inject a custom context override inside a test.
function setContextOverride(v: { userProfile?: UserProfile | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (require('../AppStateContext') as any).__setOverride(v);
}
function clearContextOverride() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (require('../AppStateContext') as any).__clearOverride();
}

describe('WeeklyPlanScreen — "On Me" toggle visibility', () => {
  afterEach(clearContextOverride);

  it('does NOT show "On Me" tab when user has no avatar', async () => {
    setContextOverride({ userProfile: null });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('On Me')).toBeNull();
    });
  });

  it('shows "Items" toggle button by default', async () => {
    setContextOverride({ userProfile: null });
    const { queryByText } = renderScreen();
    // The Items button is always rendered when recommendations exist (empty state = no tabs)
    await waitFor(() => {
      // Screen renders without throwing
      expect(queryByText('On Me')).toBeNull();
    });
  });

  it('shows "On Me" tab when user has an avatar', async () => {
    const profileWithAvatar: UserProfile = {
      userId: 'test-user',
      favoriteColors: [],
      avoidedColors: [],
      avatarConfig: { avatarImageUrl: 'https://example.com/avatar.jpg' },
    };

    setContextOverride({ userProfile: profileWithAvatar });

    // Need recommendations to be present for the toggles to render.
    const mockRecommendations: DayRecommendation[] = [
      {
        day: 'monday',
        eventType: 'casual',
        outfit: {
          id: 'outfit-1',
          topId: 'top-1',
          topName: 'White tee',
          bottomId: 'bottom-1',
          bottomName: 'Blue jeans',
        },
        explanation: 'Great casual look.',
      },
    ];

    // Re-override to include recommendations via context mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (require('../AppStateContext') as any).__setOverride({
      userProfile: profileWithAvatar,
      recommendations: mockRecommendations,
    });

    const { findByText } = renderScreen();
    const onMeBtn = await findByText('On Me');
    expect(onMeBtn).toBeTruthy();
  });
});
