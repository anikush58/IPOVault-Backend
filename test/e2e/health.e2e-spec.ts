import request from 'supertest';

import { createTestApp } from './create-test-app';

describe('GET /api/v1/health', () => {
  it('returns the success envelope without claiming database health', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        status: 'ok',
      },
    });
    expect(response.body.data).not.toHaveProperty('db');
    expect(response.body.data).not.toHaveProperty('database');

    await app.close();
  });
});
