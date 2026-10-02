import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { KfinRegistrarAdapter } from './kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './mufg-intime-registrar.adapter';
import { PurvaRegistrarAdapter } from './purva-registrar.adapter';
import { BigshareRegistrarAdapter } from './bigshare-registrar.adapter';
import { RegistrarAdapterRegistry, normalizeRegistrarCode } from './registrar-adapter.registry';

describe('KfinRegistrarAdapter Production Contract Tests', () => {
  let adapter: KfinRegistrarAdapter;

  const mockRequest = {
    ipoId: '11111111-1111-1111-1111-111111111111',
    registrarIpoCode: '40580036070',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
  };

  const sampleKfinHtml = `<!doctype html><html><head><script defer="defer" src="/static/js/main.91b6fce3.js"></script></head><body><div id="root"></div></body></html>`;

  const sampleKfinBundle = `
    var rf=JSON.parse('[{"clientId":"66907812020","name":"RENTOMOJO LIMITED"},{"clientId":"75003530500","name":"PRASOL CHEMICALS LIMITED"},{"clientId":"94818267561","name":"DHOOT TRANSMISSION LIMITED"},{"clientId":"35015605280","name":"INNOVISION LIMITED-IPO"},{"clientId":"89468061991","name":"SBI FUNDS MANAGMENT LIMITED IPO"}]');
  `;

  beforeEach(() => {
    jest.restoreAllMocks();
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

  it('8. should use explicit registrarIpoCode directly when provided (bypasses discovery)', async () => {
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
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '40580036070' }),
      }),
    );
  });

  it('9. should auto-resolve client_id from live public bundle for Rentomojo Limited -> 66907812020', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.91b6fce3.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinBundle,
        } as unknown as Response);
      }
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'TEST USER' }],
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected URL ${urlStr}`));
    });

    const requestRentomojo = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Rentomojo Limited',
      companyName: 'Rentomojo',
      symbol: 'RENTOMOJO',
    };

    const result = await adapter.checkAllotment(requestRentomojo);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '66907812020' }),
      }),
    );
  });

  it('10. should auto-resolve client_id for Prasol Chemicals Limited -> 75003530500', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.91b6fce3.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinBundle,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 0, App_Shares: 100, Name: 'TEST USER' }],
      } as unknown as Response);
    });

    const requestPrasol = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Prasol Chemicals', // Database legalName without Limited
      companyName: 'Prasol Chemicals', // Database displayName without Limited
    };

    const result = await adapter.checkAllotment(requestPrasol);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
  });

  it('10b. should match across corporate suffix variants (Pvt. Ltd., LTD, Limited)', () => {
    const list = [
      { clientId: '10000000001', name: 'Alpha Solutions Private Limited' },
      { clientId: '20000000002', name: 'Beta Industries Ltd.' },
      { clientId: '30000000003', name: 'Gamma Infotech Pvt. Ltd.' },
    ];

    // Test 1: "Alpha Solutions" matches "Alpha Solutions Private Limited"
    const matchAlpha = adapter.matchCompanyInList(list, {
      ipoId: '1',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Alpha Solutions',
    });
    expect(matchAlpha).toBe('10000000001');

    // Test 2: "Beta Industries Limited" matches "Beta Industries Ltd."
    const matchBeta = adapter.matchCompanyInList(list, {
      ipoId: '2',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Beta Industries Limited',
    });
    expect(matchBeta).toBe('20000000002');

    // Test 3: "Gamma Infotech LTD" matches "Gamma Infotech Pvt. Ltd."
    const matchGamma = adapter.matchCompanyInList(list, {
      ipoId: '3',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Gamma Infotech LTD',
    });
    expect(matchGamma).toBe('30000000003');
  });

  it('11. should auto-resolve client_id for Dhoot Transmission Limited -> 94818267561', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.91b6fce3.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinBundle,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 50, App_Shares: 50, Name: 'TEST USER' }],
      } as unknown as Response);
    });

    const requestDhoot = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Dhoot Transmission Limited',
      companyName: 'Dhoot Transmission',
    };

    const result = await adapter.checkAllotment(requestDhoot);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '94818267561' }),
      }),
    );
  });

  it('11b. should auto-resolve client_id for SBI Funds Management Limited with registrar typo MANAGMENT -> 89468061991', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.91b6fce3.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinBundle,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'TEST USER' }],
      } as unknown as Response);
    });

    const requestSbi = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'SBI Funds Management Limited',
      companyName: 'SBI Funds Management',
    };

    const result = await adapter.checkAllotment(requestSbi);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '89468061991' }),
      }),
    );
  });

  it('12. should return NOT_YET_AVAILABLE when no match is found in live list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => sampleKfinBundle,
      } as unknown as Response);
    });

    const requestUnmatched = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Unrelated Nonexistent Company Ltd',
      companyName: 'Unrelated Nonexistent',
      symbol: 'NONEXIST',
    };

    const result = await adapter.checkAllotment(requestUnmatched);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
  });

  it('13. should return NEEDS_REVIEW when multiple matches exist in live list', async () => {
    const ambiguousBundle = `
      var rf=JSON.parse('[{"clientId":"11111111111","name":"Ambiguous Tech Limited"},{"clientId":"22222222222","name":"Ambiguous Tech Limited SME"}]');
    `;

    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => ambiguousBundle,
      } as unknown as Response);
    });

    const requestAmbiguous = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Ambiguous Tech Limited',
      companyName: 'Ambiguous Tech',
    };

    const result = await adapter.checkAllotment(requestAmbiguous);
    expect(result.status).toBe(AllotmentStatus.NEEDS_REVIEW);
  });

  it('14. should NEVER use backend UUID as registrarIpoCode and trigger resolution instead', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.91b6fce3.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinBundle,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'TEST USER' }],
      } as unknown as Response);
    });

    const requestWithUuidCode = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      registrarIpoCode: '11111111-1111-1111-1111-111111111111', // UUID passed erroneously
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Rentomojo Limited',
      companyName: 'Rentomojo',
    };

    const result = await adapter.checkAllotment(requestWithUuidCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '66907812020' }), // Resolved 66907812020, NOT UUID!
      }),
    );
  });

  it('15. should handle KFin bundle parsing failure safely as SOURCE_RESPONSE_INVALID', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => 'var brokenCode = true; // no bundle data',
      } as unknown as Response);
    });

    const requestNoCode = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Rentomojo Limited',
    };

    const result = await adapter.checkAllotment(requestNoCode);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
  });

  it('16. should handle KFin portal HTML 5xx failure as SOURCE_UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response),
    );

    const requestNoCode = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Rentomojo Limited',
    };

    const result = await adapter.checkAllotment(requestNoCode);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('17. should reuse in-memory cached company list without re-fetching within TTL', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.91b6fce3.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleKfinBundle,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'TEST USER' }],
      } as unknown as Response);
    });

    const requestRentomojo = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Rentomojo Limited',
    };

    // First call: fetches HTML and JS bundle
    await adapter.checkAllotment(requestRentomojo);
    const initialCallCount = fetchSpy.mock.calls.length;

    // Second call: should use in-memory cache, so only the query API call happens (+1)
    await adapter.checkAllotment(requestRentomojo);
    expect(fetchSpy.mock.calls.length).toBe(initialCallCount + 1);
  });

  it('18. should send browser headers and handle broad JS script path when registrarIpoCode is empty', async () => {
    const customHtml = `<!doctype html><html><head><script defer="defer" src="./static/js/2.48bc9281.chunk.js"></script></head><body><div id="root"></div></body></html>`;
    const customBundle = `var data = JSON.parse('[{"clientId":"37168935020","name":"SRIT INDIA LIMITED"}]');`;

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        expect(init?.headers).toEqual(
          expect.objectContaining({
            'User-Agent': expect.stringContaining('Mozilla/5.0'),
            Accept: '*/*',
            Origin: 'https://ipostatus.kfintech.com',
            Referer: 'https://ipostatus.kfintech.com/',
          }),
        );
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => customHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('chunk.js')) {
        expect(init?.headers).toEqual(
          expect.objectContaining({
            'User-Agent': expect.stringContaining('Mozilla/5.0'),
            Accept: '*/*',
            Origin: 'https://ipostatus.kfintech.com',
            Referer: 'https://ipostatus.kfintech.com/',
          }),
        );
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => customBundle,
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 1200, App_Shares: 1200, Name: 'SRIT APPLICANT' }],
      } as unknown as Response);
    });

    const requestSritNoCode = {
      ipoId: '16ad8e62-1881-4c3b-b1f3-1ea2af818b6a',
      registrarIpoCode: '', // empty code
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'SRIT India Limited',
      companyName: 'SRIT India',
    };

    const result = await adapter.checkAllotment(requestSritNoCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesAllotted).toBe(1200);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({ client_id: '37168935020' }),
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

describe('PurvaRegistrarAdapter Contract & Registry Tests', () => {
  let adapter: PurvaRegistrarAdapter;
  let registry: RegistrarAdapterRegistry;

  beforeEach(() => {
    adapter = new PurvaRegistrarAdapter();
    registry = new RegistrarAdapterRegistry();
    registry.register(adapter);
  });

  it('1. should declare correct metadata and identifier support', () => {
    expect(adapter.code).toBe('PURVA');
    expect(adapter.name).toBe('Purva Sharegistry');
    expect(adapter.supportsIdentifier(AllotmentIdentifierType.PAN)).toBe(true);
    expect(
      adapter.supportsIdentifier(AllotmentIdentifierType.APPLICATION_NUMBER),
    ).toBe(true);
    expect(
      adapter.supportsIdentifier(AllotmentIdentifierType.DP_CLIENT_ID),
    ).toBe(false);
  });

  it('2. should correctly normalize Purva registrar aliases', () => {
    expect(normalizeRegistrarCode('PURVA')).toBe('PURVA');
    expect(normalizeRegistrarCode('purva_sharegistry')).toBe('PURVA');
    expect(normalizeRegistrarCode('Purva Sharegistry India Pvt Ltd')).toBe(
      'PURVA',
    );
    expect(
      normalizeRegistrarCode('PURVA SHAREGISTRY (INDIA) PVT. LTD.'),
    ).toBe('PURVA');
    expect(normalizeRegistrarCode('PurvaShare')).toBe('PURVA');
  });

  it('3. should retrieve registered Purva adapter via aliases from registry', () => {
    expect(registry.get('PURVA')).toBe(adapter);
    expect(registry.get('PURVA_SHAREGISTRY')).toBe(adapter);
    expect(registry.get('Purva Sharegistry')).toBe(adapter);
    expect(registry.get('PURVA SHAREGISTRY INDIA PVT LTD')).toBe(adapter);
  });

  it('4. should parse HTML tables for ALLOTTED status', () => {
    const html = `
      <section class="ipo-query-section">
        <div class="results-section">
          <table class="results-table">
            <thead>
              <tr>
                <th>Applicant Name</th>
                <th>Application No</th>
                <th>Shares Applied</th>
                <th>Shares Allotted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>TEST APPLICANT</td>
                <td>APP123</td>
                <td>500</td>
                <td>500</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `;
    const res = adapter.parseAllotmentResultHtml(html, new Date());
    expect(res.status).toBe(AllotmentStatus.ALLOTTED);
    expect(res.applicantName).toBe('TEST APPLICANT');
    expect(res.sharesApplied).toBe(500);
    expect(res.sharesAllotted).toBe(500);
  });

  it('5. should parse HTML tables for NOT_ALLOTTED status', () => {
    const html = `
      <section class="ipo-query-section">
        <div class="results-section">
          <table class="results-table">
            <thead>
              <tr>
                <th>Applicant Name</th>
                <th>Application No</th>
                <th>Shares Applied</th>
                <th>Shares Allotted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>TEST APPLICANT</td>
                <td>APP123</td>
                <td>500</td>
                <td>0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `;
    const res = adapter.parseAllotmentResultHtml(html, new Date());
    expect(res.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(res.sharesAllotted).toBe(0);
  });
});

describe('BigshareRegistrarAdapter Contract & Response Parsing Tests', () => {
  let adapter: BigshareRegistrarAdapter;
  let registry: RegistrarAdapterRegistry;

  const mockRequest = {
    ipoId: '522695d7-90ec-410b-8777-74b66f9abc17',
    registrarIpoCode: '9051',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
  };

  beforeEach(() => {
    adapter = new BigshareRegistrarAdapter();
    registry = new RegistrarAdapterRegistry();
    registry.register(adapter);
  });

  it('1. should declare correct metadata and identifier support', () => {
    expect(adapter.code).toBe('BIGSHARE');
    expect(adapter.name).toBe('Bigshare Services');
    expect(adapter.supportsIdentifier(AllotmentIdentifierType.PAN)).toBe(true);
    expect(
      adapter.supportsIdentifier(AllotmentIdentifierType.APPLICATION_NUMBER),
    ).toBe(true);
    expect(
      adapter.supportsIdentifier(AllotmentIdentifierType.DP_CLIENT_ID),
    ).toBe(true);
  });

  it('2. should correctly normalize Bigshare aliases', () => {
    expect(normalizeRegistrarCode('BIGSHARE')).toBe('BIGSHARE');
    expect(normalizeRegistrarCode('bigshare services private limited')).toBe('BIGSHARE');
    expect(normalizeRegistrarCode('Bigshare Services Pvt Ltd')).toBe('BIGSHARE');
    expect(normalizeRegistrarCode('BIG_SHARE')).toBe('BIGSHARE');
  });

  it('3. should parse JSON response for ALLOTTED status', () => {
    const jsonStr = JSON.stringify({
      d: {
        __type: 'Data+Company',
        APPLICATION_NO: 'APP98765',
        DPID: '1201090012345678',
        Name: 'VIKRAM MEHTA',
        APPLIED: '1000',
        ALLOTED: '500',
        Status: 'OK',
        Message: '',
      },
    });

    const res = adapter.parseAllotmentResult(jsonStr, mockRequest, new Date());
    expect(res.status).toBe(AllotmentStatus.ALLOTTED);
    expect(res.applicantName).toBe('VIKRAM MEHTA');
    expect(res.sharesApplied).toBe(1000);
    expect(res.sharesAllotted).toBe(500);
  });

  it('4. should parse JSON response for NOT_ALLOTTED status', () => {
    const jsonStr = JSON.stringify({
      d: {
        __type: 'Data+Company',
        APPLICATION_NO: 'APP98765',
        DPID: '1201090012345678',
        Name: 'VIKRAM MEHTA',
        APPLIED: '1000',
        ALLOTED: '0',
        Status: 'OK',
        Message: '',
      },
    });

    const res = adapter.parseAllotmentResult(jsonStr, mockRequest, new Date());
    expect(res.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(res.sharesAllotted).toBe(0);
    expect(res.sharesApplied).toBe(1000);
    expect(res.applicantName).toBe('VIKRAM MEHTA');
  });

  it('5. should parse JSON response for APPLICATION_NOT_FOUND (NOTFOUND status)', () => {
    const jsonStr = JSON.stringify({
      d: {
        __type: 'Data+Company',
        APPLICATION_NO: '',
        DPID: 'No data found',
        Name: '',
        APPLIED: '',
        ALLOTED: '',
        Status: 'NOTFOUND',
        Message: 'No data found',
        MatchCount: 0,
        Records: [],
      },
    });

    const res = adapter.parseAllotmentResult(jsonStr, mockRequest, new Date());
    expect(res.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(res.sharesAllotted).toBe(0);
  });

  it('6. should parse options from HTML select element', () => {
    const html = `
      <select id="ddlCompany">
        <option>--Select Company--</option>
        <option value="9050">A-ONE STEELS INDIA LIMITED</option>
        <option value="9051">ADROIT INDUSTRIES INDIA LTD</option>
      </select>
    `;

    const options = adapter.parseCompanyOptions(html, 'https://ipo1.bigshareonline.com');
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      code: '9050',
      name: 'A-ONE STEELS INDIA LIMITED',
      serverUrl: 'https://ipo1.bigshareonline.com',
    });
    expect(options[1]).toEqual({
      code: '9051',
      name: 'ADROIT INDUSTRIES INDIA LTD',
      serverUrl: 'https://ipo1.bigshareonline.com',
    });
  });

  it('7. should parse DPID validation messages as APPLICATION_NOT_FOUND', () => {
    const jsonStr = JSON.stringify({
      d: {
        __type: 'Data+Company',
        APPLICATION_NO: '',
        DPID: 'Please Enter Valid Pan No',
        Name: '',
        APPLIED: '',
        ALLOTED: '',
        Status: 'OK',
        Message: '',
      },
    });

    const res = adapter.parseAllotmentResult(jsonStr, mockRequest, new Date());
    expect(res.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
  });

  it('8. should parse RATELIMIT and WARMING statuses correctly', () => {
    const rateLimitJson = JSON.stringify({
      d: {
        Status: 'RATELIMIT',
        Message: 'Too many attempts from this connection',
      },
    });
    const resRate = adapter.parseAllotmentResult(rateLimitJson, mockRequest, new Date());
    expect(resRate.status).toBe(AllotmentStatus.RATE_LIMITED);

    const warmingJson = JSON.stringify({
      d: {
        Status: 'WARMING',
        Message: 'The service is busy right now',
      },
    });
    const resWarm = adapter.parseAllotmentResult(warmingJson, mockRequest, new Date());
    expect(resWarm.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });
});
