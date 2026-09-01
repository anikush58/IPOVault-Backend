import { Controller, Get } from '@nestjs/common';

import { AppException } from '../../src/common/errors/app.exception';
import { ErrorCode } from '../../src/common/errors/error-codes';

@Controller('test-errors')
export class TestErrorController {
  @Get('unexpected')
  unexpected(): never {
    throw new Error('internal diagnostic message must not leak');
  }

  @Get('app')
  app(): never {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      'Lot size must be a positive integer',
    );
  }
}
