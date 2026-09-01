import { PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'The request is invalid',
        400,
      );
    }

    return result.data;
  }
}
