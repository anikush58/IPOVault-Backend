import type { NextFunction, Request, Response } from 'express';

import { resolveRequestId } from './request-id';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
