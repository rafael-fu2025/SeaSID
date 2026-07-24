import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

function Harness({ onConfirm, tone }) {
  return (
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      onConfirm={onConfirm}
      title="Confirm action"
      description="Are you sure you want to do this?"
      confirmLabel="Delete key"
      cancelLabel="Cancel"
      tone={tone}
    />
  );
}

describe('ConfirmDialog', () => {
  it('renders title, description, cancel, and confirm buttons', () => {
    render(<Harness onConfirm={() => {}} />);
    expect(screen.getByText('Confirm action')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Delete key');
  });

  it('fires onConfirm only when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses the destructive Button variant when tone is danger', () => {
    render(<Harness onConfirm={() => {}} tone="danger" />);
    const confirm = screen.getByTestId('confirm-dialog-confirm');
    expect(confirm.getAttribute('data-variant')).toBe('destructive');
  });

  it('uses the default Button variant when tone is neutral', () => {
    render(<Harness onConfirm={() => {}} />);
    const confirm = screen.getByTestId('confirm-dialog-confirm');
    expect(confirm.getAttribute('data-variant')).toBe('default');
  });
});
