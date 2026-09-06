import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { KfinRegistrarAdapter } from './kfin-registrar.adapter';

describe('KfinRegistrarAdapter Production Contract Tests', () => {
  let adapter: KfinRegistrarAdapter;

  const mockRequest = {
    ipoId: '11111111-1111-1111-1111-111111111111',
    registrarIpoCode: '40580036070',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
  };

  beforeEach(() => {
    adapter = new KfinRegistrarAdapter();
  });

  it('1. should normalize valid KFin ALLOTTED response', () => {
    const fixture = {
      All_Shares: 1500,
      App_Shares: 1500,
      Appln_No: 'APP12345',
      Name: 'RAHUL SHARMA',
      DP_CLID: '1201090012345678',
      Pan_No: 'XXXXXX1234F',
    };

    const result = adapter.normalizeKfinResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(1500);
    expect(result.sharesAllotted).toBe(1500);
    expect(result.applicantName).toBe('RAHUL SHARMA');
    expect(result.sourceCode).toBe('KFINTECH');
  });

  it('2. should normalize valid KFin NOT_ALLOTTED response', () => {
    const fixture = {
      All_Shares: 0,
      App_Shares: 1500,
      Appln_No: 'APP12345',
      Name: 'RAHUL SHARMA',
      DP_CLID: '1201090012345678',
      Pan_No: 'XXXXXX1234F',
    };

    const result = adapter.normalizeKfinResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesAllotted).toBe(0);
  });

  it('3. should normalize KFin Record Not Found (APPLICATION_NOT_FOUND)', () => {
    const fixture = { error: 'Record Not Found' };
    const result = adapter.normalizeKfinResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
  });

  it('4. should handle malformed response safely without crashing', () => {
    const result = adapter.normalizeKfinResponse(
      null as unknown as Record<string, unknown>,
    );
    expect(result.status).toBe(AllotmentStatus.UNKNOWN);
  });

  it('5. should handle KFin 5xx error safely', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ message: 'Internal Server Error' }),
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
    expect(result.errorMessage).toContain('502');
  });

  it('6. should handle KFin request timeout safely', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('AbortError: Request timeout')),
      );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('7. should handle KFin rate limiting (HTTP 429)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.RATE_LIMITED);
  });

  it('8. should return error if missing client_id (registrarIpoCode)', async () => {
    const invalidRequest = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    };

    const result = await adapter.checkAllotment(invalidRequest);
    expect(result.status).toBe(AllotmentStatus.REGISTRAR_UNRESOLVED);
  });
});
