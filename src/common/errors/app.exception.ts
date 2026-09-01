import { ErrorCode } from './error-codes';

export class AppException extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = 'AppException';
  }
}
