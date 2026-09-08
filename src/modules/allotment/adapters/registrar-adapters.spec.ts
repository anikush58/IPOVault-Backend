import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { KfinRegistrarAdapter } from './kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './mufg-intime-registrar.adapter';

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

describe('MufgIntimeRegistrarAdapter Production Contract Tests', () => {
  let adapter: MufgIntimeRegistrarAdapter;

  const mockRequest = {
    ipoId: '22222222-2222-2222-2222-222222222222',
    registrarIpoCode: 'MUFG_IPO_001',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'XYZAB5678C',
  };

  beforeEach(() => {
    adapter = new MufgIntimeRegistrarAdapter();
  });

  it('1. should normalize valid MUFG ALLOTTED response', () => {
    const fixture = {
      status: 'SUCCESS',
      applied_shares: 50,
      allotted_shares: 50,
      price: 250,
      name: 'PRIYA PATEL',
      app_no: 'MUFG123456',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(50);
    expect(result.sharesAllotted).toBe(50);
    expect(result.allotmentPrice).toBe(250);
    expect(result.applicantName).toBe('PRIYA PATEL');
    expect(result.sourceCode).toBe('MUFG_INTIME');
  });

  it('2. should normalize valid MUFG PARTIALLY_ALLOTTED response', () => {
    const fixture = {
      status: 'SUCCESS',
      applied_shares: 100,
      allotted_shares: 50,
      name: 'PRIYA PATEL',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
    expect(result.sharesApplied).toBe(100);
    expect(result.sharesAllotted).toBe(50);
  });

  it('3. should normalize valid MUFG NOT_ALLOTTED response', () => {
    const fixture = {
      status: 'SUCCESS',
      applied_shares: 50,
      allotted_shares: 0,
      name: 'PRIYA PATEL',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesAllotted).toBe(0);
  });

  it('4. should normalize MUFG CAPTCHA_REQUIRED response', () => {
    const fixture = {
      status: 'CAPTCHA_REQUIRED',
      require_captcha: true,
      sessionId: 'mufg_session_123',
      captchaUrl: 'https://in.mpms.mufg.com/captcha.png',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.CAPTCHA_REQUIRED);
    expect(result.captchaChallenge).toBeDefined();
    expect(result.captchaChallenge?.challengeType).toBe('IMAGE_CAPTCHA');
    expect(result.captchaChallenge?.challengeId).toBe('mufg_session_123');
  });

  it('5. should normalize MUFG NOT_YET_AVAILABLE response', () => {
    const fixture = {
      status: 'PENDING',
      message: 'Basis of allotment under process',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
  });

  it('6. should normalize MUFG RECORD_NOT_FOUND response', () => {
    const fixture = {
      status: 'NOT_FOUND',
      message: 'No Data Found',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
  });

  it('7. should handle MUFG HTTP 429 Rate Limiting safely', async () => {
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

  it('8. should handle MUFG network errors safely', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('Network connection failed')),
      );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });
});
