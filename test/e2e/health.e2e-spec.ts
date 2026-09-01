import request from 'supertest';

import { createTestApp } from './create-test-app';

describe('GET /api/v1/health', () => {
  it('returns ok with a database status field', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        database: 'up',
      },
    });

    await app.close();
  });
});
