import { describe, it, expect } from 'vitest';
import { normalizeText } from '../../engine/utils.js';

describe('normalizeText - extra cases', () => {
  it('removes punctuation and collapses spaces', () => {
    expect(normalizeText('  Hello,   world!! ')).toBe('helloworld');
  });

  it('handles diacritics and ligatures-ish gracefully', () => {
    expect(normalizeText('Žluťoučký kůň')).toBe('zlutouckykun');
    expect(normalizeText('Crème brûlée')).toBe('cremebrulee');
  });

  it('is robust to null/undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});
