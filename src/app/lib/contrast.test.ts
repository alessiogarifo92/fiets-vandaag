import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, cssTokens, luminance } from './contrast';

const tokens = cssTokens(readFileSync(new URL('../app.css', import.meta.url), 'utf8'));

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1a6b5e', '#1a6b5e')).toBe(1);
  });

  it('rejects a non-hex colour', () => {
    expect(() => luminance('red')).toThrow();
  });
});

// Every text colour the screens use, on every ground it appears on.
const pairs: [text: string, ground: string][] = [
  ['--ink', '--mist'],
  ['--ink', '--card'],
  ['--ink', '--window'],
  ['--reed', '--mist'],
  ['--reed', '--card'],
  ['--reed', '--window'],
  ['--polder', '--mist'],
  ['--polder', '--card'],
  ['--polder', '--window'],
  ['--card', '--ink'], // verdict pill, primary button, best-moment row
];

describe('Polder tokens meet WCAG AA (4.5:1) for text', () => {
  it.each(pairs)('%s on %s', (text, ground) => {
    expect(contrastRatio(tokens[text]!, tokens[ground]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('rain bars stay above 3:1 on white (non-text, WCAG 1.4.11)', () => {
    expect(contrastRatio(tokens['--rain']!, tokens['--card']!)).toBeGreaterThanOrEqual(3);
  });
});
