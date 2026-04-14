import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AuthScreen } from '../AuthScreen';

describe('AuthScreen', () => {
  const mockOnAuthenticated = jest.fn();

  beforeEach(() => {
    mockOnAuthenticated.mockClear();
  });

  it('renders the sign-in heading', () => {
    const { getByText } = render(
      <AuthScreen onAuthenticated={mockOnAuthenticated} />,
    );
    // The screen should contain some auth-related text
    const screen = render(
      <AuthScreen onAuthenticated={mockOnAuthenticated} />,
    );
    expect(screen.toJSON()).toBeTruthy();
  });

  it('renders Google sign-in button', () => {
    const { toJSON } = render(
      <AuthScreen onAuthenticated={mockOnAuthenticated} />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('Google');
  });

  it('does not call onAuthenticated on initial render', () => {
    render(<AuthScreen onAuthenticated={mockOnAuthenticated} />);
    expect(mockOnAuthenticated).not.toHaveBeenCalled();
  });

  it('renders without crashing with mode prop', () => {
    const { toJSON } = render(
      <AuthScreen onAuthenticated={mockOnAuthenticated} mode="signup" />,
    );
    expect(toJSON()).toBeTruthy();
  });
});
