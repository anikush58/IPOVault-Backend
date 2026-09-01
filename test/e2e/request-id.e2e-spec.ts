import request from 'supertest';

import { createTestApp } from './create-test-app';

describe('request ID', () => {
  it('generates X-Request-Id when the client does not send one', async () => {
    const app = await createTestApp();

    const response = await request(app.getHttpServer()).get('/api/v1/health');

    const requestId = response.headers['x-request-id'];
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);
    expect(requestId).toMatch(/^[A-Za-z0-9._-]+$/);

    await app.close();
  });

  it('reuses a valid incoming X-Request-Id', async () => {
    const app = await createTestApp();
    const incoming = 'client-request-abc';

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', incoming);

    expect(response.headers['x-request-id']).toBe(incoming);

    await app.close();
  });

  it('replaces an invalid incoming X-Request-Id', async () => {
    const app = await createTestApp();
    const incoming = 'not a valid id';

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', incoming);

    expect(response.headers['x-request-id']).not.toBe(incoming);
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]+$/);

    await app.close();
  });

  it('includes requestId on error responses', async () => {
    const app = await createTestApp();
    const incoming = 'error-request-1';

    const response = await request(app.getHttpServer())
      .get('/api/v1/missing')
      .set('X-Request-Id', incoming);

    expect(response.headers['x-request-id']).toBe(incoming);
    expect(response.body.error.requestId).toBe(incoming);

    await app.close();
  });
});
