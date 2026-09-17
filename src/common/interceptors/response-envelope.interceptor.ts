import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (typeof body === 'string') {
          return body;
        }

        if (
          body !== null &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          'data' in body
        ) {
          return body;
        }

        return { data: body };
      }),
    );
  }
}
