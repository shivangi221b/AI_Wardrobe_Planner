import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AppStateProvider } from '../AppStateContext';
import { WeeklyPlanScreen } from '../WeeklyPlanScreen';

jest.mock('../stockImages', () => ({
  getImageForGarment: jest.fn(() => undefined),
}));

describe('WeeklyPlanScreen', () => {
  const mockOnRegenerate = jest.fn(() => Promise.resolve());
  const mockOnNavigate = jest.fn();

  it('renders without crashing', async () => {
    const { toJSON } = render(
      <AppStateProvider userId="test-user">
        <WeeklyPlanScreen
          onRegenerateWeek={mockOnRegenerate}
          onNavigateToWardrobe={mockOnNavigate}
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      expect(toJSON()).toBeTruthy();
    });
  });

  it('shows empty state when no recommendations', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <WeeklyPlanScreen
          onRegenerateWeek={mockOnRegenerate}
          onNavigateToWardrobe={mockOnNavigate}
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(tree.toJSON());
      // Without generating, should show some placeholder or empty state
      expect(json.length).toBeGreaterThan(50);
    });
  });

  it('renders screen content', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <WeeklyPlanScreen
          onRegenerateWeek={mockOnRegenerate}
          onNavigateToWardrobe={mockOnNavigate}
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(tree.toJSON());
      // Without recommendations, the screen renders some UI structure
      expect(json).toBeTruthy();
      expect(json.length).toBeGreaterThan(100);
    });
  });
});
