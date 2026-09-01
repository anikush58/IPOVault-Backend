import { isValidRequestId, resolveRequestId } from './request-id';

describe('request ID', () => {
  it('accepts UUID and simple token values', () => {
    expect(isValidRequestId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    expect(isValidRequestId('req_123')).toBe(true);
  });

  it('rejects empty, oversized, or unsafe values', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('has spaces')).toBe(false);
    expect(isValidRequestId('id\nwith\nnewlines')).toBe(false);
    expect(isValidRequestId('a'.repeat(129))).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
  });

  it('returns a valid incoming id and generates otherwise', () => {
    expect(resolveRequestId('client-id-1')).toBe('client-id-1');
    expect(resolveRequestId(['client-id-1'])).toBe('client-id-1');
    expect(isValidRequestId(resolveRequestId('not valid'))).toBe(true);
    expect(resolveRequestId('not valid')).not.toBe('not valid');
  });
});
