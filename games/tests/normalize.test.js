import { describe, it, expect } from 'vitest';
import { normalizeText } from '../../engine/utils.js';

describe('normalizeText', () => {
    it('lowercases and strips accents', () => {
        expect(normalizeText('PŔŮŮŠA')).toBe('pruusa');
        expect(normalizeText('  Ahoj  ')).toBe('ahoj');
    });
});
