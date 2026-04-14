import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SearchableSelect } from '../SearchableSelect';

describe('SearchableSelect', () => {
  const defaultProps = {
    label: 'Color',
    value: '',
    onChange: jest.fn(),
    options: ['Red', 'Blue', 'Green', 'Yellow'],
  };

  beforeEach(() => {
    (defaultProps.onChange as jest.Mock).mockClear();
  });

  it('renders with label', () => {
    const { getByText } = render(<SearchableSelect {...defaultProps} />);
    expect(getByText('Color')).toBeTruthy();
  });

  it('shows "Any" when value is empty and optional', () => {
    const { getByText } = render(
      <SearchableSelect {...defaultProps} optional={true} />,
    );
    expect(getByText('Any')).toBeTruthy();
  });

  it('shows current value when set', () => {
    const { getByText } = render(
      <SearchableSelect {...defaultProps} value="Red" />,
    );
    expect(getByText('Red')).toBeTruthy();
  });

  it('opens modal on press', () => {
    const { getByLabelText, getByPlaceholderText } = render(
      <SearchableSelect {...defaultProps} />,
    );
    fireEvent.press(getByLabelText('Color, Any'));
    // When modal opens, the filter input should be visible
    expect(getByPlaceholderText('Type to filter…')).toBeTruthy();
  });

  it('filters options by text input', async () => {
    const { getByLabelText, getByPlaceholderText, getByText, queryByText } =
      render(<SearchableSelect {...defaultProps} />);
    fireEvent.press(getByLabelText('Color, Any'));
    fireEvent.changeText(getByPlaceholderText('Type to filter…'), 're');
    await waitFor(() => {
      expect(getByText('Red')).toBeTruthy();
      expect(getByText('Green')).toBeTruthy();
      expect(queryByText('Blue')).toBeNull();
    });
  });

  it('calls onChange when option is selected', () => {
    const { getByLabelText, getByText } = render(
      <SearchableSelect {...defaultProps} />,
    );
    fireEvent.press(getByLabelText('Color, Any'));
    fireEvent.press(getByText('Blue'));
    expect(defaultProps.onChange).toHaveBeenCalledWith('Blue');
  });

  it('shows custom emptyLabel', () => {
    const { getByText } = render(
      <SearchableSelect {...defaultProps} emptyLabel="None" />,
    );
    expect(getByText('None')).toBeTruthy();
  });
});
