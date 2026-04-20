import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AuthScreen } from '../AuthScreen';

describe('AuthScreen', () => {
  const mockOnAuthenticated = jest.fn();

  beforeEach(() => {
    mockOnAuthenticated.mockClear();
  });

  it('renders the sign-in heading', () => {
    const { getByText } = render(<AuthScreen onAuthenticated={mockOnAuthenticated} />);
    expect(getByText('Welcome back')).toBeTruthy();
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

  it('switches to sign up copy when Sign up is pressed', () => {
    const { getByText } = render(<AuthScreen onAuthenticated={mockOnAuthenticated} />);
    fireEvent.press(getByText('Sign up'));
    expect(getByText('Create your account')).toBeTruthy();
  });

  it('shows email fields', () => {
    const { getByPlaceholderText } = render(<AuthScreen onAuthenticated={mockOnAuthenticated} />);
    expect(getByPlaceholderText('you@example.com')).toBeTruthy();
  });
});
