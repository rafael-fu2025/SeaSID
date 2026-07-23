import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownResponse, { sanitizeModelOutput } from '@/components/MarkdownResponse';

describe('model output sanitization', () => {
  it('removes complete and stray think tags', () => {
    expect(sanitizeModelOutput('Safe<think>secret</think> answer')).toBe('Safe answer');
    expect(sanitizeModelOutput('<think>dangling')).toBe('');
  });

  it('never renders internal reasoning', () => {
    render(<MarkdownResponse>{'Forecast <think>private chain</think> is safe.'}</MarkdownResponse>);
    expect(screen.getByText(/forecast/i)).toHaveTextContent('Forecast is safe.');
    expect(screen.queryByText(/private chain/i)).toBeNull();
  });
});
