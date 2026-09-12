import request from 'supertest';

import { createTestApp } from './create-test-app';

describe('Health & Readiness API', () => {
  it('GET /api/v1/health - returns liveness ok status', async () => {
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

  it('GET /api/v1/ready - returns readiness ok status when database is responsive', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get('/api/v1/ready');

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
