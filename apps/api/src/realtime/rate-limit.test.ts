import { describe, expect, it } from 'vitest';

function hitRateLimitForTest(limit: number, hits: number): boolean {
  let count = 0;
  for (let i = 0; i < hits; i += 1) {
    count += 1;
    if (count > limit) {
      return true;
    }
  }

  return false;
}

describe('rate limiter helper', () => {
  it('does not limit below threshold', () => {
    expect(hitRateLimitForTest(5, 5)).toBe(false);
  });

  it('limits above threshold', () => {
    expect(hitRateLimitForTest(5, 6)).toBe(true);
  });
});
