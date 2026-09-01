import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { resolveRequestId } from '../request-id/request-id';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = resolveRequestId(
      request.requestId ?? request.headers['x-request-id'],
    );

    if (!request.requestId) {
      request.requestId = requestId;
    }

    if (!response.getHeader('X-Request-Id')) {
      response.setHeader('X-Request-Id', requestId);
    }

    const { status, code, message } = this.normalize(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          requestId,
          err:
            exception instanceof Error
              ? { name: exception.name, message: exception.message }
              : { message: String(exception) },
        },
        'Unhandled exception',
      );
    } else {
      this.logger.warn({ requestId, code, status }, message);
    }

    response.status(status).json({
      error: {
        code,
        message,
        requestId,
      },
    });
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      return {
        status,
        code: this.codeForHttpStatus(status),
        message: this.publicHttpMessage(status),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    };
  }

  private codeForHttpStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      default:
        if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
          return ErrorCode.INTERNAL_ERROR;
        }
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  private publicHttpMessage(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'The request is invalid';
      case HttpStatus.NOT_FOUND:
        return 'The requested resource was not found';
      default:
        if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
          return 'An unexpected error occurred';
        }
        return 'The request could not be completed';
    }
  }
}
