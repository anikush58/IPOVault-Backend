export const ErrorCode = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  IPO_NOT_FOUND: 'IPO_NOT_FOUND',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
