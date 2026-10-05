import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { KfinRegistrarAdapter } from './kfin-registrar.adapter';
import { KFIN_VERIFIED_FALLBACK_REGISTRY } from '../discovery/kfin-identity-discovery.adapter';

describe('KFin Zero-Touch Allotment Hardening & Regression Suite', () => {
  let adapter: KfinRegistrarAdapter;

  const sampleLiveHtml = `<!doctype html><html><head><script defer="defer" src="/static/js/main.30273529.js"></script></head><body><div id="root"></div></body></html>`;

  // Mock live bundle with both established and newly launched live IPOs
  const sampleLiveBundle = `
    var rf=JSON.parse('[{"clientId":"94818267561","name":"DHOOT TRANSMISSION LIMITED"},{"clientId":"66907812020","name":"RENTOMOJO LIMITED"},{"clientId":"99998888777","name":"BRAND NEW TECHNO ENTERPRISES LIMITED"},{"clientId":"12345123451","name":"AMBIGUOUS GLOBAL ALPHA LIMITED"},{"clientId":"12345123452","name":"AMBIGUOUS GLOBAL BETA LIMITED"}]');
  `;

  beforeEach(() => {
    jest.restoreAllMocks();
    adapter = new KfinRegistrarAdapter();
  });

  it('1. Existing IPO -> explicit/configured clientId -> existing allotment flow works directly', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              All_Shares: 150,
              App_Shares: 150,
              Name: 'ANISH KUSHWAHA',
              Appln_No: 'APP-9988',
              Pan_No: 'XXXXXX1234F',
            },
          ],
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
    });

    const req = {
      ipoId: 'dhoot-transmission-ipo-id',
      registrarIpoCode: '94818267561',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Dhoot Transmission Limited',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesAllotted).toBe(150);
    expect(result.applicantName).toBe('ANISH KUSHWAHA');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('type=pan'),
      expect.objectContaining({
        headers: expect.objectContaining({
          client_id: '94818267561',
          reqparam: 'ABCDE1234F',
        }),
      }),
    );
  });

  it('2. Brand new IPO live on KFin (no DB code) -> clientId discovered on-the-fly and checked', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.30273529.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveBundle,
        } as unknown as Response);
      }
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              All_Shares: 50,
              App_Shares: 100,
              Name: 'NEW INVESTOR',
              Appln_No: 'APP-7766',
            },
          ],
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
    });

    const newIpoReq = {
      ipoId: 'new-ipo-without-db-code',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZPK9876Q',
      companyName: 'Brand New Techno Enterprises Limited',
      companyLegalName: 'Brand New Techno Enterprises Ltd',
    };

    const result = await adapter.checkAllotment(newIpoReq);
    expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
    expect(result.sharesApplied).toBe(100);
    expect(result.sharesAllotted).toBe(50);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({
          client_id: '99998888777',
          reqparam: 'XYZPK9876Q',
        }),
      }),
    );
  });

  it('3. Runtime discovery takes precedence over static fallback', async () => {
    const customBundle = `
      var rf=JSON.parse('[{"clientId":"OVERRIDDEN-CLIENT-ID-999","name":"SRIT INDIA LIMITED"}]');
    `;

    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.30273529.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => customBundle,
        } as unknown as Response);
      }
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'SRIT USER' }],
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const sritReq = {
      ipoId: 'srit-ipo-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'SRIT India Limited',
    };

    const result = await adapter.checkAllotment(sritReq);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
  });

  it('4. Temporary runtime discovery failure -> fallback registry safely resolves known company via discovery adapter', async () => {
    const { KfinIdentityDiscoveryAdapter } = require('../discovery/kfin-identity-discovery.adapter');
    const discoveryAdapter = new KfinIdentityDiscoveryAdapter();

    // Primary and secondary network attempts fail
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com')) {
        return Promise.reject(new Error('CloudFront CDN Network Unreachable'));
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const issues = await discoveryAdapter.discoverIssues();
    expect(issues.length).toBe(KFIN_VERIFIED_FALLBACK_REGISTRY.length);
    const sritFallback = issues.find((i: any) => i.externalName === 'SRIT INDIA LIMITED');
    expect(sritFallback).toBeDefined();
    expect(sritFallback?.externalId).toBe('37168935020');

    // And adapter returns SOURCE_UNAVAILABLE when live portal is unreachable without guessed ID
    const sritFallbackReq = {
      ipoId: 'srit-fallback-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'SRIT India Limited',
    };

    const result = await adapter.checkAllotment(sritFallbackReq);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('5. Unknown IPO not in KFin live registry or fallback -> NOT_YET_AVAILABLE (no guessing)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.30273529.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveBundle,
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const unknownReq = {
      ipoId: 'completely-unknown-ipo',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Unknown Nonexistent Solar Tech Limited',
    };

    const result = await adapter.checkAllotment(unknownReq);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    expect(result.errorMessage).toContain('IPO not found in KFin Technologies live active list');
  });

  it('6. Ambiguous IPO match -> NEEDS_REVIEW safely without guessing', async () => {
    const ambiguousBundle = `
      var rf=JSON.parse('[{"clientId":"12345123451","name":"AMBIGUOUS GLOBAL LIMITED"},{"clientId":"12345123452","name":"AMBIGUOUS GLOBAL LIMITED"}]');
    `;

    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.30273529.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => ambiguousBundle,
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const ambiguousReq = {
      ipoId: 'ambiguous-ipo',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Ambiguous Global Limited',
    };

    const result = await adapter.checkAllotment(ambiguousReq);
    expect(result.status).toBe(AllotmentStatus.NEEDS_REVIEW);
    expect(result.errorMessage).toContain('Multiple');
  });

  it('7. Existing Application Number lookup flow sends type=appno', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 200, App_Shares: 200, Name: 'APP USER' }],
      } as Response);
    });

    const appReq = {
      ipoId: 'test-ipo-id',
      registrarIpoCode: '94818267561',
      identifierType: AllotmentIdentifierType.APPLICATION_NUMBER,
      identifierValue: '12345678|ABCDE1234F',
    };

    const result = await adapter.checkAllotment(appReq);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('type=appno'),
      expect.anything(),
    );
  });

  it('8. Existing DP/CLID lookup flow sends type=dpclid', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [{ All_Shares: 0, App_Shares: 100, Name: 'DP USER' }],
      } as Response);
    });

    const dpReq = {
      ipoId: 'test-ipo-id',
      registrarIpoCode: '94818267561',
      identifierType: AllotmentIdentifierType.DP_CLIENT_ID,
      identifierValue: '1208160012345678',
    };

    const result = await adapter.checkAllotment(dpReq);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('type=dpclid'),
      expect.anything(),
    );
  });

  it('9. Existing 404 No Record handling maps to APPLICATION_NOT_FOUND', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);
    });

    const notFoundReq = {
      ipoId: 'test-ipo-id',
      registrarIpoCode: '94818267561',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    };

    const result = await adapter.checkAllotment(notFoundReq);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(result.sourceCode).toBe('KFINTECH');
  });

  it('10. In-memory caching avoids duplicate HTTP bundle downloads within TTL', async () => {
    let bundleFetches = 0;
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com') && !urlStr.includes('.js')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveHtml,
        } as unknown as Response);
      }
      if (urlStr.includes('main.30273529.js')) {
        bundleFetches++;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => sampleLiveBundle,
        } as unknown as Response);
      }
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ All_Shares: 100, App_Shares: 100, Name: 'USER' }],
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const req1 = {
      ipoId: 'ipo-1',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Rentomojo Limited',
    };

    const req2 = {
      ipoId: 'ipo-2',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'XYZPK9876Q',
      companyName: 'Dhoot Transmission Limited',
    };

    await adapter.checkAllotment(req1);
    await adapter.checkAllotment(req2);

    expect(bundleFetches).toBe(1); // Second query reused the in-memory cached company registry!
  });
});
