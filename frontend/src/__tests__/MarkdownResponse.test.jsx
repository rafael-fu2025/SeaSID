import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownResponse from '../components/MarkdownResponse';

describe('MarkdownResponse', () => {
  it('renders plain text', () => {
    render(<MarkdownResponse>Hello world</MarkdownResponse>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('strips emoji pictographs from the source', () => {
    const { container } = render(
      <MarkdownResponse>Current: 35 km/h — unsafe for small boats. ⚠️</MarkdownResponse>
    );
    expect(container.textContent).not.toMatch(/⚠️/);
    expect(container.textContent).toMatch(/unsafe for small boats/);
  });

  it('renders headings, lists, and inline code with the markdown class', () => {
    const md = '# Heading\n\n- one\n- two\n\nUse `code` inline.';
    const { container } = render(<MarkdownResponse>{md}</MarkdownResponse>);
    expect(container.querySelector('h1')).toHaveTextContent(/heading/i);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('code')).toHaveTextContent(/code/);
  });

  it('renders markdown links with target=_blank rel=noopener', () => {
    const { container } = render(<MarkdownResponse>[link](https://example.com)</MarkdownResponse>);
    const a = container.querySelector('a');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toMatch(/noopener/);
  });

  it('renders a GFM-friendly inline code block', () => {
    const { container } = render(<MarkdownResponse>Use `inline code` in prose.</MarkdownResponse>);
    expect(container.querySelector('code')).toHaveTextContent(/inline code/);
  });

  it('renders GitHub-flavored markdown tables as a table', () => {
    const markdown = [
      '| Tool | What it does |',
      '| --- | --- |',
      '| get_weather | Detailed weather conditions |',
      '| list_sites | Available dive sites |',
    ].join('\n');
    const { container } = render(<MarkdownResponse>{markdown}</MarkdownResponse>);

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tool' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'get_weather' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Detailed weather conditions' })).toBeInTheDocument();
  });
});
