import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Dropdown from '../components/Dropdown';

const OPTIONS = [
  { value: 'dauin_muck', label: 'Dauin Muck Bays', description: 'muck' },
  { value: 'apo_reef',   label: 'Apo Island Reef',   description: 'reef' },
];

describe('Dropdown', () => {
  it('renders the current value as the trigger label', () => {
    render(<Dropdown value="dauin_muck" onChange={() => {}} options={OPTIONS} ariaLabel="Test" id="t1" />);
    expect(screen.getByRole('button', { name: /test/i })).toHaveTextContent(/dauin muck bays/i);
  });

  it('opens the menu when clicked and lists every option', async () => {
    render(<Dropdown value="dauin_muck" onChange={() => {}} options={OPTIONS} ariaLabel="Test" id="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /test/i }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByTestId('dropdown-option-dauin_muck')).toBeInTheDocument();
    expect(screen.getByTestId('dropdown-option-apo_reef')).toBeInTheDocument();
  });

  it('calls onChange with the new value when an option is clicked', async () => {
    const onChange = vi.fn();
    render(<Dropdown value="dauin_muck" onChange={onChange} options={OPTIONS} ariaLabel="Test" id="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /test/i }));
    fireEvent.click(screen.getByTestId('dropdown-option-apo_reef'));
    expect(onChange).toHaveBeenCalledWith('apo_reef');
  });

  it('marks the current value as selected (aria-selected)', async () => {
    render(<Dropdown value="apo_reef" onChange={() => {}} options={OPTIONS} ariaLabel="Test" id="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /test/i }));
    await waitFor(() => {
      expect(screen.getByTestId('dropdown-option-apo_reef')).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByTestId('dropdown-option-dauin_muck')).toHaveAttribute('aria-selected', 'false');
  });

  it('closes when Escape is pressed', async () => {
    render(<Dropdown value="dauin_muck" onChange={() => {}} options={OPTIONS} ariaLabel="Test" id="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /test/i }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });
});
