import { describe, expect, it } from 'vitest';
import { formatSen, parseRM } from './money';

describe('money', () => {
  it('formats sen as RM', () => {
    expect(formatSen(1234)).toBe('RM 12.34');
    expect(formatSen(0)).toBe('RM 0.00');
    expect(formatSen(150000000)).toBe('RM 1,500,000.00');
    expect(formatSen(-500)).toBe('-RM 5.00');
  });

  it('parses RM strings to sen', () => {
    expect(parseRM('12.34')).toBe(1234);
    expect(parseRM('1,500.00')).toBe(150000);
    expect(parseRM('0.005')).toBe(1); // rounds half up to nearest sen
    expect(parseRM('abc')).toBeNull();
    expect(parseRM('-5')).toBeNull();
    expect(parseRM('')).toBeNull();
  });
});
