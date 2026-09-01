import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

function createHost(requestId?: string) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const getHeader = jest.fn().mockReturnValue(undefined);

  const response = { status, setHeader, getHeader };
  const request = {
    requestId,
    headers: requestId ? { 'x-request-id': requestId } : {},
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as ArgumentsHost;

  return { host, json, status, setHeader };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the standard error envelope for AppException', () => {
    const { host, json, status } = createHost('req-1');

    filter.catch(
      new AppException(ErrorCode.NOT_FOUND, 'IPO was not found', 404),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'IPO was not found',
        requestId: 'req-1',
      },
    });
  });

  it('does not expose stack traces or internal messages for unexpected errors', () => {
    const { host, json, status } = createHost('req-2');
    const error = new Error('database password is hunter2');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0] as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.error.message).toBe('An unexpected error occurred');
    expect(body.error.requestId).toBe('req-2');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('maps HttpException 404 to a public NOT_FOUND envelope', () => {
    const { host, json } = createHost('req-3');

    filter.catch(
      new HttpException('Cannot GET /secret', HttpStatus.NOT_FOUND),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'The requested resource was not found',
        requestId: 'req-3',
      },
    });
  });
});
