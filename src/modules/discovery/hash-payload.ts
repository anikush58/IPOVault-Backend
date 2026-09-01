import { createHash } from 'node:crypto';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }

  return value;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(payload)))
    .digest('hex');
}
