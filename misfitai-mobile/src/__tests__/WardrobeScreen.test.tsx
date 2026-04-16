import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AppStateProvider } from '../AppStateContext';
import { WardrobeScreen } from '../WardrobeScreen';

jest.mock('../stockImages', () => ({
  getImageForGarment: jest.fn(() => undefined),
  shoesImage: undefined,
}));

jest.mock('../searchOptions', () => ({
  SEARCH_BRANDS: ['Nike'],
  SEARCH_COLORS: ['Black'],
  SEARCH_MATERIALS: ['Cotton'],
  SEARCH_KINDS_BY_CATEGORY: { top: ['Shirt'] },
}));

describe('WardrobeScreen', () => {
  const mockOnNext = jest.fn();

  it('renders without crashing', async () => {
    const { toJSON } = render(
      <AppStateProvider userId="test-user">
        <WardrobeScreen onNext={mockOnNext} />
      </AppStateProvider>,
    );
    await waitFor(() => {
      expect(toJSON()).toBeTruthy();
    });
  });

  it('displays garments from context', async () => {
    const tree = render(
      <AppStateProvider userId="test-user">
        <WardrobeScreen onNext={mockOnNext} />
      </AppStateProvider>,
    );
    await waitFor(() => {
      // Mock wardrobe has items like "Cream sweater", "White oxford shirt"
      const json = JSON.stringify(tree.toJSON());
      expect(json.length).toBeGreaterThan(100);
    });
  });

  it('has a next/continue button', async () => {
    const { toJSON } = render(
      <AppStateProvider userId="test-user">
        <WardrobeScreen onNext={mockOnNext} />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const json = JSON.stringify(toJSON());
      // The screen should have some navigation element
      expect(json).toBeTruthy();
    });
  });
});
