import request from 'supertest';

import { createTestApp } from './create-test-app';
import { TestErrorController } from './test-error.controller';

describe('global error response', () => {
  it('returns the error envelope for unknown routes', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get(
      '/api/v1/does-not-exist',
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBe(
      'The requested resource was not found',
    );
    expect(typeof response.body.error.requestId).toBe('string');
    expect(response.body.error.requestId.length).toBeGreaterThan(0);
    expect(response.body).not.toHaveProperty('stack');
    expect(JSON.stringify(response.body)).not.toContain('Cannot GET');

    await app.close();
  });

  it('does not leak internal details for unexpected errors', async () => {
    const app = await createTestApp([TestErrorController]);

    const response = await request(app.getHttpServer()).get(
      '/api/v1/test-errors/unexpected',
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'internal diagnostic message',
    );

    await app.close();
  });

  it('returns AppException code and message in the envelope', async () => {
    const app = await createTestApp([TestErrorController]);

    const response = await request(app.getHttpServer()).get(
      '/api/v1/test-errors/app',
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe(
      'Lot size must be a positive integer',
    );

    await app.close();
  });
});
