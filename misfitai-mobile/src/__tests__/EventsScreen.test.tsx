import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { AppStateProvider } from '../AppStateContext';
import { EventsScreen } from '../EventsScreen';

describe('EventsScreen', () => {
  const mockOnGenerate = jest.fn(() => Promise.resolve());

  beforeEach(() => {
    mockOnGenerate.mockClear();
  });

  it('renders without crashing', async () => {
    const { toJSON } = render(
      <AppStateProvider userId="test-user">
        <EventsScreen onGenerate={mockOnGenerate} />
      </AppStateProvider>,
    );
    await waitFor(() => {
      expect(toJSON()).toBeTruthy();
    });
  });

  it('renders all 7 days', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <EventsScreen onGenerate={mockOnGenerate} />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(tree.toJSON());
      expect(json).toContain('Monday');
      expect(json).toContain('Friday');
      expect(json).toContain('Sunday');
    });
  });

  it('renders event type options', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <EventsScreen onGenerate={mockOnGenerate} />
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
        <EventsScreen onGenerate={mockOnGenerate} />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(tree.toJSON());
      // Should contain "Generate" text for the looks/plan generation button
      expect(
        json.includes('Generate') || json.includes('Plan') || json.includes('Looks'),
      ).toBe(true);
    });
  });
});
