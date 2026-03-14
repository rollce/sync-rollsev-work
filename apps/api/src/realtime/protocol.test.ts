import { clientEventSchema, PROTOCOL_VERSION } from '@sync/shared';
import { describe, expect, it } from 'vitest';

describe('client protocol validation', () => {
  it('accepts a valid join event', () => {
    const result = clientEventSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      type: 'JOIN_BOARD',
      boardId: 'demo-board',
      lastServerSeq: 7
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid protocol version', () => {
    const result = clientEventSchema.safeParse({
      protocolVersion: 999,
      type: 'JOIN_BOARD',
      boardId: 'demo-board',
      lastServerSeq: 7
    });

    expect(result.success).toBe(false);
  });
});
