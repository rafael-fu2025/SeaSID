import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  GaugeIcon, WaveIcon, WindIcon, DropIcon, AlertIcon, BrainIcon,
} from '../components/icons';

describe('icon set', () => {
  it('renders each named icon as an <svg>', () => {
    for (const Icon of [GaugeIcon, WaveIcon, WindIcon, DropIcon, AlertIcon, BrainIcon]) {
      const { container } = render(<Icon />);
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('honors a custom size prop', () => {
    const { container } = render(<WaveIcon size={24} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });
});
