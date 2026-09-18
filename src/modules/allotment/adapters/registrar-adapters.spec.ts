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
    registrarIpoCode: '11937',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'xyzab5678c',
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    adapter = new MufgIntimeRegistrarAdapter();
  });

  it('1. should encrypt token correctly using AES-128-CBC with key/iv 8080808080808080', () => {
    const encrypted = adapter.encryptToken(63435);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);

    // Verify deterministic encryption
    const encryptedAgain = adapter.encryptToken(63435);
    expect(encryptedAgain).toBe(encrypted);
  });

  it('2. should execute 2-step flow: generateToken -> SearchOnPan with session cookie, configured registrarIpoCode, and uppercased PAN', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('generateToken')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'set-cookie': 'ASP.NET_SessionId=sess_test_12345; path=/; HttpOnly',
          }),
          json: async () => ({ d: 98765 }),
        } as unknown as Response);
      }

      if (urlStr.includes('SearchOnPan')) {
        const body = JSON.parse(init?.body as string);
        expect(body.clientid).toBe('11937');
        expect(body.PAN).toBe('XYZAB5678C'); // Uppercased
        expect(body.CHKVAL).toBe('1');
        expect(body.IFSC).toBe('');
        expect(body.token).toBeDefined();

        const headers = init?.headers as Record<string, string>;
        expect(headers['Cookie']).toBe('ASP.NET_SessionId=sess_test_12345');

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            d: '<NewDataSet><Table><id>11937</id><companyname>Manika Plastech Limited - IPO</companyname><ALLOT>0</ALLOT><SHARES>348</SHARES><offer_price>43</offer_price><name>PRIYA PATEL</name><app_no>APP999</app_no></Table></NewDataSet>',
          }),
        } as unknown as Response);
      }

      return Promise.reject(new Error(`Unexpected URL ${urlStr}`));
    });

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesApplied).toBe(348);
    expect(result.sharesAllotted).toBe(0);
    expect(result.allotmentPrice).toBe(43);
    expect(result.applicantName).toBe('PRIYA PATEL');
    expect(result.sourceCode).toBe('MUFG_INTIME');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('3. should normalize valid MUFG XML ALLOTTED response (ALLOT > 0)', () => {
    const fixture = {
      d: '<NewDataSet><Table><id>11937</id><companyname>Manika Plastech Limited - IPO</companyname><ALLOT>348</ALLOT><SHARES>348</SHARES><offer_price>43</offer_price><name>PRIYA PATEL</name><app_no>APP999</app_no></Table></NewDataSet>',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(348);
    expect(result.sharesAllotted).toBe(348);
    expect(result.allotmentPrice).toBe(43);
    expect(result.applicantName).toBe('PRIYA PATEL');
  });

  it('4. should normalize valid MUFG XML PARTIALLY_ALLOTTED response', () => {
    const fixture = {
      d: '<NewDataSet><Table><id>11937</id><companyname>Manika Plastech Limited - IPO</companyname><ALLOT>174</ALLOT><SHARES>348</SHARES><offer_price>43</offer_price><name>PRIYA PATEL</name></Table></NewDataSet>',
    };

    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
    expect(result.sharesApplied).toBe(348);
    expect(result.sharesAllotted).toBe(174);
  });

  it('5. should normalize empty NewDataSet (<NewDataSet />) to APPLICATION_NOT_FOUND', () => {
    const fixture1 = { d: '<NewDataSet />' };
    const fixture2 = { d: '<NewDataSet/>' };
    const fixture3 = { d: '<NewDataSet></NewDataSet>' };

    expect(adapter.normalizeMufgResponse(fixture1, mockRequest).status).toBe(
      AllotmentStatus.APPLICATION_NOT_FOUND,
    );
    expect(adapter.normalizeMufgResponse(fixture2, mockRequest).status).toBe(
      AllotmentStatus.APPLICATION_NOT_FOUND,
    );
    expect(adapter.normalizeMufgResponse(fixture3, mockRequest).status).toBe(
      AllotmentStatus.APPLICATION_NOT_FOUND,
    );
  });

  it('6. should normalize malformed XML response to SOURCE_RESPONSE_INVALID', () => {
    const fixture = { d: '<html><body>Service Error</body></html>' };
    const result = adapter.normalizeMufgResponse(fixture, mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
  });

  it('7. should NEVER use backend UUID as registrarIpoCode and trigger resolution instead', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('GetDetails')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            d: '<NewDataSet><Table><company_id>11937</company_id><companyname>Manika Plastech Limited - IPO</companyname></Table></NewDataSet>',
          }),
        } as unknown as Response);
      }

      if (urlStr.includes('generateToken')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'set-cookie': 'ASP.NET_SessionId=sess_uuid_test; path=/',
          }),
          json: async () => ({ d: 11223 }),
        } as unknown as Response);
      }

      if (urlStr.includes('SearchOnPan')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            d: '<NewDataSet><Table><id>11937</id><companyname>Manika Plastech Limited - IPO</companyname><ALLOT>348</ALLOT><SHARES>348</SHARES><name>PRIYA PATEL</name></Table></NewDataSet>',
          }),
        } as unknown as Response);
      }

      return Promise.reject(new Error(`Unexpected URL ${urlStr}`));
    });

    const requestWithUuidCode = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      registrarIpoCode: '22222222-2222-2222-2222-222222222222', // Erroneously passed UUID
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZAB5678C',
      companyLegalName: 'Manika Plastech Limited',
      companyName: 'Manika Plastech',
    };

    const result = await adapter.checkAllotment(requestWithUuidCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);

    // Verify SearchOnPan was called with the resolved 11937, NOT the UUID
    const searchCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes('SearchOnPan'),
    );
    expect(searchCall).toBeDefined();
    const searchBody = JSON.parse(searchCall![1]?.body as string);
    expect(searchBody.clientid).toBe('11937');
  });

  it('8. should handle MUFG HTTP 429 Rate Limiting safely', async () => {
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

  it('9. should handle MUFG network errors safely', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('Network connection failed')),
      );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('10. should handle JSON parse errors gracefully as SOURCE_RESPONSE_INVALID', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('generateToken')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'set-cookie': 'ASP.NET_SessionId=sess_test; path=/',
          }),
          json: async () => ({ d: 12345 }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '<html><body>Error</body></html>',
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response);
    });

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
  });
});
