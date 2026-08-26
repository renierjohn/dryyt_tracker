import { describe, it, expect } from 'vitest';
import { generateCode } from '../plugins/workflow/backend/code';

describe('generateCode', () => {
  it('returns a 6-character code using only the safe alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('is not the same value on every call', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
