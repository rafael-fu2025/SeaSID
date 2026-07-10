/**
 * SiteSelector was removed when Dashboard/Forecast moved to the new
 * custom <Dropdown> component. The Dropdown has its own test suite; this
 * shim exists to keep test discovery from looking for a moved file.
 */
import { describe, it, expect } from 'vitest';

describe('SiteSelector (deprecated)', () => {
  it('was replaced by the Dropdown component', () => {
    expect(true).toBe(true);
  });
});
