import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AppStateProvider } from '../AppStateContext';
import { EventsScreen } from '../EventsScreen';

describe('EventsScreen', () => {
  const mockOnGenerate = jest.fn(() => Promise.resolve());
  const mockOnBackToWardrobe = jest.fn();

  beforeEach(() => {
    mockOnGenerate.mockClear();
    mockOnBackToWardrobe.mockClear();
  });

  it('renders without crashing', async () => {
    const { toJSON } = render(
      <AppStateProvider userId="test-user">
        <EventsScreen
          onGenerate={mockOnGenerate}
          onBackToWardrobe={mockOnBackToWardrobe}
          wardrobeStepComplete
          calendarStepComplete
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      expect(toJSON()).toBeTruthy();
    });
  });

  it('renders all 7 days', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <EventsScreen
          onGenerate={mockOnGenerate}
          onBackToWardrobe={mockOnBackToWardrobe}
          wardrobeStepComplete
          calendarStepComplete
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      expect(tree.queryAllByText('No major event')).toHaveLength(7);
    });
  });

  it('renders event type options', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <EventsScreen
          onGenerate={mockOnGenerate}
          onBackToWardrobe={mockOnBackToWardrobe}
          wardrobeStepComplete
          calendarStepComplete
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(tree.toJSON());
      // Should show event type labels
      expect(json).toContain('No major event');
    });
  });

  it('has a generate button', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <EventsScreen
          onGenerate={mockOnGenerate}
          onBackToWardrobe={mockOnBackToWardrobe}
          wardrobeStepComplete
          calendarStepComplete
        />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(tree.toJSON());
      expect(json).toContain('Next: Generate outfits');
    });
  });
});
