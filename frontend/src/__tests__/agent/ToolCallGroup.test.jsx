import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallGroup } from '@/components/agent/ToolCallGroup';

const CALLS = [
  { name: 'web_search', arguments: { q: 'tide' }, result: 'A' },
  { name: 'get_forecast', arguments: { site_key: 'dauin_muck' }, result: 'B' },
];

describe('ToolCallGroup', () => {
  it('returns null when calls is empty', () => {
    const { container } = render(<ToolCallGroup calls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single row inline without group chrome', () => {
    render(
      <ToolCallGroup
        calls={[{ name: 'get_forecast', result: 'ok' }]}
      />,
    );
    // No group header is rendered
    expect(screen.queryByTestId('tool-call-group')).toBeNull();
    // The single row is rendered
    expect(screen.getByTestId('tool-call-row-get_forecast')).toBeInTheDocument();
  });

  it('renders a collapsed group header with call count for multiple calls', () => {
    render(<ToolCallGroup calls={CALLS} />);
    const header = screen.getByTestId('tool-call-group-toggle');
    expect(header).toBeInTheDocument();
    expect(header.textContent).toMatch(/2 tool calls/);
    // Individual rows are hidden behind the closed group
    expect(screen.queryByTestId('tool-call-row-web_search')).toBeNull();
    expect(screen.queryByTestId('tool-call-row-get_forecast')).toBeNull();
    // The header shows the *latest* call so the user can read
    // what's currently happening even when collapsed
    expect(header.textContent).toMatch(/latest: get_forecast/);
  });

  it('expands to show every row when clicked', () => {
    render(<ToolCallGroup calls={CALLS} />);
    fireEvent.click(screen.getByTestId('tool-call-group-toggle'));
    expect(screen.getByTestId('tool-call-row-web_search')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-row-get_forecast')).toBeInTheDocument();
  });
});
