import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import Dropdown from '@/components/Dropdown';

const OPTIONS = [
  { value: 'dauin_muck', label: 'Dauin Muck Bays', description: 'muck' },
  { value: 'apo_reef',   label: 'Apo Island Reef',   description: 'reef' },
];

function renderDropdown(props) {
  return render(
    <TooltipProvider>
      <Dropdown {...props} />
    </TooltipProvider>,
  );
}

describe('Dropdown (shadcn Select shim)', () => {
  it('renders the trigger with role=combobox and current label as the value text', () => {
    renderDropdown({ value: 'dauin_muck', onChange: () => {}, options: OPTIONS, ariaLabel: 'Test', id: 't1' });
    const trigger = screen.getByRole('combobox', { name: /test/i });
    expect(trigger).toHaveTextContent(/dauin muck bays/i);
  });

  it('opens the menu when clicked and lists every option', async () => {
    renderDropdown({ value: 'dauin_muck', onChange: () => {}, options: OPTIONS, ariaLabel: 'Test', id: 't1' });
    fireEvent.click(screen.getByRole('combobox', { name: /test/i }));
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(withinListbox(listbox, 'Dauin Muck Bays')).toBeInTheDocument();
    expect(withinListbox(listbox, 'Apo Island Reef')).toBeInTheDocument();
  });

  it('calls onChange with the new value when an option is picked', async () => {
    const onChange = vi.fn();
    renderDropdown({ value: 'dauin_muck', onChange, options: OPTIONS, ariaLabel: 'Test', id: 't1' });
    fireEvent.click(screen.getByRole('combobox', { name: /test/i }));
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(withinListbox(listbox, 'Apo Island Reef'));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('apo_reef');
    });
  });

  it('renders aria-selected on the current value', async () => {
    renderDropdown({ value: 'apo_reef', onChange: () => {}, options: OPTIONS, ariaLabel: 'Test', id: 't1' });
    fireEvent.click(screen.getByRole('combobox', { name: /test/i }));
    const listbox = await screen.findByRole('listbox');
    const current = withinListbox(listbox, 'Apo Island Reef').closest('[role="option"]');
    expect(current).toHaveAttribute('aria-selected', 'true');
  });
});

/** Find a labelled option inside the listbox. Returns the <SelectItem>. */
function withinListbox(listbox, label) {
  return Array.from(listbox.querySelectorAll('[role="option"]'))
    .find((el) => el.textContent.includes(label));
}
