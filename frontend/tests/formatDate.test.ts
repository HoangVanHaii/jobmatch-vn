import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from '@/utils/format';

describe('formatDate', () => {
  it('formats Date instance to "HH:mm · DD/MM/YYYY"', () => {
    const d = new Date(2026, 9, 11, 6, 54); // October 11, 2026, 06:54
    expect(formatDate(d)).toBe('06:54 · 11/10/2026');
  });

  it('pads single-digit hours, minutes, days, and months with zero', () => {
    const d = new Date(2026, 0, 5, 4, 7); // Jan 5, 2026, 04:07
    expect(formatDate(d)).toBe('04:07 · 05/01/2026');
  });

  it('formats timestamp number', () => {
    const d = new Date(2026, 9, 11, 6, 54);
    expect(formatDate(d.getTime())).toBe('06:54 · 11/10/2026');
  });

  it('formats object with updatedAt or createdAt', () => {
    const d = new Date(2026, 9, 11, 6, 54);
    expect(formatDate({ updatedAt: d })).toBe('06:54 · 11/10/2026');
    expect(formatDate({ createdAt: d })).toBe('06:54 · 11/10/2026');
    expect(formatDate({ updatedAt: null, createdAt: d })).toBe('06:54 · 11/10/2026');
  });

  it('handles null, undefined, empty string and invalid dates', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('invalid-date')).toBe('');
  });

  it('supports custom fallback string', () => {
    expect(formatDate(null, '—')).toBe('—');
    expect(formatDate('invalid-date', 'N/A')).toBe('N/A');
  });

  it('formatDateTime is an alias of formatDate', () => {
    expect(formatDateTime).toBe(formatDate);
  });
});
