import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function resolveRequestId(incoming: unknown): string {
  const header = Array.isArray(incoming) ? incoming[0] : incoming;

  if (isValidRequestId(header)) {
    return header;
  }

  return randomUUID();
}
