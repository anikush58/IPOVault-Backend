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

  it('8. should use explicit registrarIpoCode directly when provided', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          {
            All_Shares: 100,
            App_Shares: 100,
            Name: 'TEST USER',
          },
        ],
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '40580036070' }),
      }),
    );
  });

  it('9. should auto-resolve client_id from live public list when registrarIpoCode is null', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('type=company')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { client_id: '12345', company_name: 'Manika Moulds Limited', symbol: 'MANIKA' },
          ],
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'TEST USER' }],
      } as Response);
    });

    const requestNoCode = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Manika Moulds Limited',
      companyName: 'Manika Moulds',
      symbol: 'MANIKA',
    };

    const result = await adapter.checkAllotment(requestNoCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '12345' }),
      }),
    );
  });

  it('10. should return NOT_YET_AVAILABLE when no match is found in live list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          { client_id: '99999', company_name: 'Unrelated Company Ltd', symbol: 'OTHER' },
        ],
      } as Response),
    );

    const requestUnmatched = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Manika Moulds Limited',
      companyName: 'Manika Moulds',
      symbol: 'MANIKA',
    };

    const result = await adapter.checkAllotment(requestUnmatched);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
  });

  it('11. should return NEEDS_REVIEW when multiple matches exist in live list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          { client_id: '11111', company_name: 'Manika Moulds Limited', symbol: 'MANIKA' },
          { client_id: '22222', company_name: 'Manika Moulds Limited', symbol: 'MANIKA' },
        ],
      } as Response),
    );

    const requestAmbiguous = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Manika Moulds Limited',
      companyName: 'Manika Moulds',
      symbol: 'MANIKA',
    };

    const result = await adapter.checkAllotment(requestAmbiguous);
    expect(result.status).toBe(AllotmentStatus.NEEDS_REVIEW);
  });

  it('12. should NEVER use backend UUID as registrarIpoCode and trigger resolution instead', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('type=company')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { client_id: '88888', company_name: 'Manika Moulds Limited', symbol: 'MANIKA' },
          ],
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'TEST USER' }],
      } as Response);
    });

    const requestWithUuidCode = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      registrarIpoCode: '11111111-1111-1111-1111-111111111111', // UUID passed erroneously
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Manika Moulds Limited',
      symbol: 'MANIKA',
    };

    const result = await adapter.checkAllotment(requestWithUuidCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '88888' }), // Resolved 88888, NOT the UUID!
      }),
    );
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
    jest.restoreAllMocks();
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

  it('9. should auto-resolve clientid from live public list when registrarIpoCode is null', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('getCompanyList')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ clientid: 'MUFG_777', companyname: 'Manika Moulds Limited' }]),
          json: async () => [{ clientid: 'MUFG_777', companyname: 'Manika Moulds Limited' }],
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'SUCCESS', applied_shares: 50, allotted_shares: 50, name: 'PRIYA PATEL' }),
        json: async () => ({ status: 'SUCCESS', applied_shares: 50, allotted_shares: 50, name: 'PRIYA PATEL' }),
      } as unknown as Response);
    });

    const requestNoCode = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZAB5678C',
      companyLegalName: 'Manika Moulds Limited',
      companyName: 'Manika Moulds',
    };

    const result = await adapter.checkAllotment(requestNoCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('public-issues.html'),
      expect.objectContaining({
        body: expect.stringContaining('MUFG_777'),
      }),
    );
  });

  it('9b. should return NOT_YET_AVAILABLE when no match is found in MUFG live list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ clientid: 'MUFG_999', companyname: 'Other Corp Ltd' }]),
        json: async () => [{ clientid: 'MUFG_999', companyname: 'Other Corp Ltd' }],
      } as unknown as Response),
    );

    const requestUnmatched = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZAB5678C',
      companyLegalName: 'Manika Moulds Limited',
    };

    const result = await adapter.checkAllotment(requestUnmatched);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
  });

  it('9c. should return NEEDS_REVIEW when multiple matches exist in MUFG live list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            { clientid: 'MUFG_1', companyname: 'Manika Moulds Limited' },
            { clientid: 'MUFG_2', companyname: 'Manika Moulds Limited' },
          ]),
        json: async () => [
          { clientid: 'MUFG_1', companyname: 'Manika Moulds Limited' },
          { clientid: 'MUFG_2', companyname: 'Manika Moulds Limited' },
        ],
      } as unknown as Response),
    );

    const requestAmbiguous = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZAB5678C',
      companyLegalName: 'Manika Moulds Limited',
    };

    const result = await adapter.checkAllotment(requestAmbiguous);
    expect(result.status).toBe(AllotmentStatus.NEEDS_REVIEW);
  });

  it('9d. should NEVER use backend UUID as MUFG registrarIpoCode and trigger resolution instead', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('getCompanyList')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ clientid: 'MUFG_555', companyname: 'Manika Moulds Limited' }]),
          json: async () => [{ clientid: 'MUFG_555', companyname: 'Manika Moulds Limited' }],
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'SUCCESS', applied_shares: 50, allotted_shares: 50, name: 'PRIYA PATEL' }),
        json: async () => ({ status: 'SUCCESS', applied_shares: 50, allotted_shares: 50, name: 'PRIYA PATEL' }),
      } as unknown as Response);
    });

    const requestWithUuidCode = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      registrarIpoCode: '22222222-2222-2222-2222-222222222222', // UUID passed erroneously
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZAB5678C',
      companyLegalName: 'Manika Moulds Limited',
    };

    const result = await adapter.checkAllotment(requestWithUuidCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('public-issues.html'),
      expect.objectContaining({
        body: expect.stringContaining('MUFG_555'), // Used MUFG_555, NOT the UUID!
      }),
    );
  });

  it('10. should handle APPLICATION_NUMBER query correctly', async () => {
    const appRequest = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      registrarIpoCode: 'MUFG_IPO_001',
      identifierType: AllotmentIdentifierType.APPLICATION_NUMBER,
      identifierValue: '12345678',
    };

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'SUCCESS',
          applied_shares: 100,
          allotted_shares: 100,
          name: 'TEST USER',
        }),
      } as Response),
    );

    const result = await adapter.checkAllotment(appRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalled();
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    const fetchBody = JSON.parse(
      (lastCall[1] as RequestInit).body as string,
    );
    expect(fetchBody.searchtype).toBe('APP');
    expect(fetchBody.searchValue).toBe('12345678');
  });

  it('11. should handle DP_CLIENT_ID query correctly', async () => {
    const dpidRequest = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      registrarIpoCode: 'MUFG_IPO_001',
      identifierType: AllotmentIdentifierType.DP_CLIENT_ID,
      identifierValue: '1201090012345678',
    };

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'SUCCESS',
          applied_shares: 50,
          allotted_shares: 0,
          name: 'TEST USER',
        }),
      } as Response),
    );

    const result = await adapter.checkAllotment(dpidRequest);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    const fetchBody = JSON.parse(
      (lastCall[1] as RequestInit).body as string,
    );
    expect(fetchBody.searchtype).toBe('DPID');
    expect(fetchBody.searchValue).toBe('1201090012345678');
  });

  it('12. should normalize INVALID_IDENTIFIER response', () => {
    const fixture = {
      status: 'INVALID_IDENTIFIER',
      message: 'Invalid PAN format provided',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.INVALID_IDENTIFIER);
  });

  it('13. should normalize TEMPORARY_ERROR response', () => {
    const fixture = {
      status: 'TEMPORARY_ERROR',
      message: 'Service temporarily unavailable, try again later',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.TEMPORARY_ERROR);
  });

  it('14. should handle JSON parse errors gracefully as SOURCE_RESPONSE_INVALID', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '<html><body>Error</body></html>',
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
  });

  it('15. should NEVER convert unrecognized response into NOT_ALLOTTED', () => {
    const fixture = {
      status: 'UNKNOWN_CODE',
      random_field: 'something',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
    expect(result.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
  });
});
