import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallRow } from '@/components/agent/ToolCallRow';

describe('ToolCallRow', () => {
  it('infers status from result presence (no status prop)', () => {
    const { rerender } = render(<ToolCallRow call={{ name: 'get_forecast' }} />);
    expect(screen.getByTestId('tool-call-row-get_forecast').dataset.status).toBe('pending');

    rerender(
      <ToolCallRow
        call={{ name: 'get_forecast', result: '{"ok":true}' }}
      />,
    );
    expect(screen.getByTestId('tool-call-row-get_forecast').dataset.status).toBe('complete');

    rerender(
      <ToolCallRow
        call={{ name: 'get_forecast', error: 'boom' }}
      />,
    );
    expect(screen.getByTestId('tool-call-row-get_forecast').dataset.status).toBe('error');
  });

  it('honours an explicit status prop', () => {
    render(
      <ToolCallRow
        call={{ name: 'web_search', status: 'running' }}
      />,
    );
    expect(screen.getByTestId('tool-call-row-web_search').dataset.status).toBe('running');
  });

  it('renders a one-field argument preview when arguments is an object', () => {
    render(
      <ToolCallRow
        call={{ name: 'get_forecast', arguments: { site_key: 'dauin_muck' } }}
      />,
    );
    expect(screen.getByText(/site_key=/)).toBeInTheDocument();
  });

  it('toggles a detail panel with input + output on click', () => {
    render(
      <ToolCallRow
        call={{
          name: 'calculate',
          arguments: { expr: '2+2' },
          result: '4',
        }}
      />,
    );

    // Detail panel hidden initially
    expect(screen.queryByText('Input')).toBeNull();
    expect(screen.queryByText('Output')).toBeNull();

    fireEvent.click(screen.getByTestId('tool-call-toggle-calculate'));

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    // Output body shows the raw result
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('auto-opens the detail panel on error', () => {
    render(
      <ToolCallRow
        call={{
          name: 'get_forecast',
          arguments: { site_key: 'dauin_muck' },
          error: 'API timeout',
        }}
      />,
    );
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('API timeout')).toBeInTheDocument();
  });

  it('shows duration when provided and complete', () => {
    render(
      <ToolCallRow
        call={{ name: 'get_forecast', result: 'ok', durationMs: 1234, status: 'complete' }}
      />,
    );
    // 1234 ms formats as 1.2s
    expect(screen.getByText('1.2s')).toBeInTheDocument();
  });
});
