import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { AppStateProvider, useAppState } from '../AppStateContext';

function TestConsumer() {
  const state = useAppState();
  return (
    <>
      <Text testID="userId">{state.userId}</Text>
      <Text testID="garmentCount">{state.garments.length}</Text>
      <Text testID="recCount">{state.recommendations.length}</Text>
    </>
  );
}

describe('AppStateProvider', () => {
  it('renders children', () => {
    const { getByText } = render(
      <AppStateProvider userId="test-user">
        <Text>Hello</Text>
      </AppStateProvider>,
    );
    expect(getByText('Hello')).toBeTruthy();
  });

  it('provides userId from prop', async () => {
    const { getByTestId } = render(
      <AppStateProvider userId="custom-user">
        <TestConsumer />
      </AppStateProvider>,
    );
    await waitFor(() => {
      expect(getByTestId('userId').props.children).toBe('custom-user');
    });
  });

  it('generates fallback userId when none provided', async () => {
    const { getByTestId } = render(
      <AppStateProvider>
        <TestConsumer />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const uid = getByTestId('userId').props.children;
      expect(typeof uid).toBe('string');
      expect(uid.length).toBeGreaterThan(0);
    });
  });

  it('loads mock wardrobe on mount', async () => {
    const { getByTestId } = render(
      <AppStateProvider userId="test-user">
        <TestConsumer />
      </AppStateProvider>,
    );
    await waitFor(() => {
      const count = Number(getByTestId('garmentCount').props.children);
      expect(count).toBeGreaterThan(0);
    });
  });

  it('starts with empty recommendations', () => {
    const { getByTestId } = render(
      <AppStateProvider userId="test-user">
        <TestConsumer />
      </AppStateProvider>,
    );
    expect(Number(getByTestId('recCount').props.children)).toBe(0);
  });
});

describe('useAppState outside provider', () => {
  it('throws when used outside provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useAppState must be used within AppStateProvider',
    );
    spy.mockRestore();
  });
});
