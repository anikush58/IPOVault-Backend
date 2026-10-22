import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { KfinRegistrarAdapter } from './kfin-registrar.adapter';
import {
  KFIN_VERIFIED_FALLBACK_REGISTRY,
  KfinIdentityDiscoveryAdapter,
} from '../discovery/kfin-identity-discovery.adapter';

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
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url: unknown) => {
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

  it('2. Generic regression test: hypothetical new KFin company (company name → discovered clientId → query configuration) works without any hardcoded mapping', async () => {
    const hypotheticalBundle = `
      var rf=JSON.parse('[{"clientId":"88887777666","name":"FUTURE QUANTUM ROBOTICS LIMITED"}]');
    `;

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (
          urlStr.includes('ipostatus.kfintech.com') &&
          !urlStr.includes('.js')
        ) {
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
            text: async () => hypotheticalBundle,
          } as unknown as Response);
        }
        if (urlStr.includes('0uz601ms56.execute-api')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              {
                All_Shares: 75,
                App_Shares: 150,
                Name: 'QUANTUM APPLICANT',
                Appln_No: 'APP-FQR-9900',
              },
            ],
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
      });

    // Verify hypothetical company is NOT in fallback registry
    const inFallback = KFIN_VERIFIED_FALLBACK_REGISTRY.some(
      (entry) =>
        entry.clientId === '88887777666' ||
        entry.name.includes('FUTURE QUANTUM'),
    );
    expect(inFallback).toBe(false);

    const hypotheticalReq = {
      ipoId: 'hypothetical-fqr-ipo-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Future Quantum Robotics Limited',
      companyLegalName: 'Future Quantum Robotics Ltd',
    };

    const result = await adapter.checkAllotment(hypotheticalReq);
    expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
    expect(result.sharesApplied).toBe(150);
    expect(result.sharesAllotted).toBe(75);
    expect(result.applicantName).toBe('QUANTUM APPLICANT');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('0uz601ms56.execute-api'),
      expect.objectContaining({
        headers: expect.objectContaining({
          client_id: '88887777666',
          reqparam: 'ABCDE1234F',
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
      if (
        urlStr.includes('ipostatus.kfintech.com') &&
        !urlStr.includes('.js')
      ) {
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
          json: async () => [
            { All_Shares: 100, App_Shares: 100, Name: 'SRIT USER' },
          ],
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
    const sritFallback = issues.find(
      (i: { externalName: string }) => i.externalName === 'SRIT INDIA LIMITED',
    );
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
      if (
        urlStr.includes('ipostatus.kfintech.com') &&
        !urlStr.includes('.js')
      ) {
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
    expect(result.errorMessage).toContain(
      'IPO not found in KFin Technologies live active list',
    );
  });

  it('6. Ambiguous IPO match -> NEEDS_REVIEW safely without guessing', async () => {
    const ambiguousBundle = `
      var rf=JSON.parse('[{"clientId":"12345123451","name":"AMBIGUOUS GLOBAL LIMITED"},{"clientId":"12345123452","name":"AMBIGUOUS GLOBAL LIMITED"}]');
    `;

    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (
        urlStr.includes('ipostatus.kfintech.com') &&
        !urlStr.includes('.js')
      ) {
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
        json: async () => [
          { All_Shares: 200, App_Shares: 200, Name: 'APP USER' },
        ],
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
      if (
        urlStr.includes('ipostatus.kfintech.com') &&
        !urlStr.includes('.js')
      ) {
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
          json: async () => [
            { All_Shares: 100, App_Shares: 100, Name: 'USER' },
          ],
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

  it('11. KFin zero-touch discovery dynamically extracts Sollfege Smart Electronics clientId 47651989560 from live bundle without relying on fallback registry', async () => {
    const sollfegeLiveBundle = `
      var rf=JSON.parse('[{"clientId":"47651989560","name":"SOLLFEGE SMART ELECTRONICS LIMITED"}]');
    `;

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (
          urlStr.includes('ipostatus.kfintech.com') &&
          !urlStr.includes('.js')
        ) {
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
            text: async () => sollfegeLiveBundle,
          } as unknown as Response);
        }
        if (urlStr.includes('0uz601ms56.execute-api')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              {
                All_Shares: 0,
                App_Shares: 1200,
                Name: 'SOLLFEGE APPLICANT',
                Appln_No: 'APP-112233',
              },
            ],
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
      });

    const sollfegeReq = {
      ipoId: 'sollfege-ipo-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Sollfege Smart Electronics Limited',
    };

    const result = await adapter.checkAllotment(sollfegeReq);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesApplied).toBe(1200);
    expect(result.sharesAllotted).toBe(0);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('type=pan'),
      expect.objectContaining({
        headers: expect.objectContaining({
          client_id: '47651989560',
          reqparam: 'ABCDE1234F',
        }),
      }),
    );
  });

  it('12. KFin explicit unavailable/not-finalized response maps to NOT_YET_AVAILABLE (Allotment Not Available)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'NOT_DECLARED',
          message: 'Allotment is awaited from registrar',
        }),
      } as unknown as Response);
    });

    const req = {
      ipoId: 'test-ipo-id',
      registrarIpoCode: '47651989560',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    expect(result.errorMessage).toContain('awaited');
  });

  it('13. KFin HTTP 500 / 502 / network error maps to SOURCE_UNAVAILABLE (Check Failed) without masking', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      } as unknown as Response);
    });

    const req = {
      ipoId: 'test-ipo-id',
      registrarIpoCode: '47651989560',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
    expect(result.errorMessage).toContain('502');
  });

  it('14. KFin malformed JSON response maps to SOURCE_RESPONSE_INVALID without silent conversion', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      } as unknown as Response);
    });

    const req = {
      ipoId: 'test-ipo-id',
      registrarIpoCode: '47651989560',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
  });

  it('15. Tonbo Imaging India: Successful live discovery from KFin SPA bundle resolves clientId 15211216041', async () => {
    const liveBundleWithTonbo = `
      var rf=JSON.parse('[{"clientId":"15211216041","name":"TONBO IMAGING INDIA LIMITED"},{"clientId":"29931891190","name":"ZETWERK MANUFACTURING BUSINESSES LIMITED"}]');
    `;

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (
          urlStr.includes('ipostatus.kfintech.com') &&
          !urlStr.includes('.js')
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => sampleLiveHtml,
          } as unknown as Response);
        }
        if (
          urlStr.includes('main.30273529.js') ||
          urlStr.includes('main.9f7d02b5.js') ||
          urlStr.includes('.js')
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => liveBundleWithTonbo,
          } as unknown as Response);
        }
        if (urlStr.includes('0uz601ms56.execute-api')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              {
                All_Shares: 21,
                App_Shares: 21,
                Name: 'TONBO APPLICANT',
                Appln_No: 'APP-TONBO-001',
              },
            ],
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unexpected ${urlStr}`));
      });

    // Test with exact name from the portal
    const exactReq = {
      ipoId: 'tonbo-imaging-ipo-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'TONBO IMAGING INDIA LIMITED',
    };
    const exactCode = await adapter.resolveRegistrarIpoCode(exactReq);
    expect(exactCode).toBe('15211216041');

    // Test with display name and legal name
    const displayReq = {
      ipoId: 'tonbo-imaging-ipo-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
      companyLegalName: 'Tonbo Imaging India Limited',
      symbol: 'TONBO',
    };
    const displayCode = await adapter.resolveRegistrarIpoCode(displayReq);
    expect(displayCode).toBe('15211216041');

    // Verify end-to-end allotment query reaches API gateway with client_id 15211216041
    const result = await adapter.checkAllotment(displayReq);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesAllotted).toBe(21);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('type=pan'),
      expect.objectContaining({
        headers: expect.objectContaining({
          client_id: '15211216041',
        }),
      }),
    );
  });

  it('16. Tonbo Imaging India: Fallback registry successfully resolves clientId 15211216041 when live bundle fetch fails', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com')) {
        return Promise.reject(new Error('CloudFront CDN 403 Forbidden'));
      }
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Record Not Found' }),
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const tonboReq = {
      ipoId: 'tonbo-imaging-ipo-id',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
      companyLegalName: 'Tonbo Imaging India Limited',
      symbol: 'TONBO',
    };

    const resolvedCode = await adapter.resolveRegistrarIpoCode(tonboReq);
    expect(resolvedCode).toBe('15211216041');

    const result = await adapter.checkAllotment(tonboReq);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(result.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.status).not.toBe(AllotmentStatus.NOT_YET_AVAILABLE);
  });

  it('17. Tonbo Imaging India: When allotment is awaited/not finalized from registrar API, checkAllotment returns NOT_YET_AVAILABLE and never invents NOT_ALLOTTED', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            error: 'Allotment is under process. Please check later.',
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    const tonboReq = {
      ipoId: 'tonbo-imaging-ipo-id',
      registrarIpoCode: '15211216041',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
    };

    const result = await adapter.checkAllotment(tonboReq);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    expect(result.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.status).not.toBe(AllotmentStatus.ALLOTTED);
    expect(result.status).not.toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(result.errorMessage).toContain('under process');
  });

  it('18. Tonbo Imaging India: Genuine no-allotment response from KFin (applied=21, allotted=0) returns NOT_ALLOTTED strictly when supported by valid registrar data', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          {
            All_Shares: 0,
            App_Shares: 21,
            Name: 'FAMILY MEMBER ONE',
            Appln_No: 'APP-TONBO-001',
          },
        ],
      } as unknown as Response);
    });

    const req = {
      ipoId: 'tonbo-imaging-ipo-id',
      registrarIpoCode: '15211216041',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesApplied).toBe(21);
    expect(result.sharesAllotted).toBe(0);
    expect(result.applicantName).toBe('FAMILY MEMBER ONE');
    expect(result.status).not.toBe(AllotmentStatus.NOT_YET_AVAILABLE);
  });

  it('19. Tonbo Imaging India: Confirmed allotment response from KFin (applied=21, allotted=21) returns ALLOTTED', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          {
            All_Shares: 21,
            App_Shares: 21,
            Name: 'FAMILY MEMBER TWO',
            Appln_No: 'APP-TONBO-002',
          },
        ],
      } as unknown as Response);
    });

    const req = {
      ipoId: 'tonbo-imaging-ipo-id',
      registrarIpoCode: '15211216041',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(21);
    expect(result.sharesAllotted).toBe(21);
    expect(result.applicantName).toBe('FAMILY MEMBER TWO');
    expect(result.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
  });

  it('20. Tonbo Imaging India: Technical failure HTTP 502 Bad Gateway maps to SOURCE_UNAVAILABLE', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      } as unknown as Response);
    });

    const req = {
      ipoId: 'tonbo-imaging-ipo-id',
      registrarIpoCode: '15211216041',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
    expect(result.errorMessage).toContain('502');
  });

  it('21. Tonbo Imaging India: Malformed HTML returned instead of JSON maps to SOURCE_RESPONSE_INVALID', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      } as unknown as Response);
    });

    const req = {
      ipoId: 'tonbo-imaging-ipo-id',
      registrarIpoCode: '15211216041',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Tonbo Imaging India',
    };

    const result = await adapter.checkAllotment(req);
    expect(result.status).toBe(AllotmentStatus.SOURCE_RESPONSE_INVALID);
  });

  it('22. Fallback cache TTL: Fallback registry is cached for at most 30s so live portal recovery is not delayed for 1 hour', async () => {
    let failDiscovery = true;
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('ipostatus.kfintech.com')) {
        if (failDiscovery) {
          // First attempt fails -> fallback used
          return Promise.reject(new Error('CloudFront transient error'));
        }
        // Subsequent attempt after TTL expires succeeds
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            urlStr.includes('.js')
              ? `var rf=JSON.parse('[{"clientId":"15211216041","name":"TONBO IMAGING INDIA LIMITED"}]');`
              : sampleLiveHtml,
        } as unknown as Response);
      }
      return Promise.reject(new Error(`Unexpected ${urlStr}`));
    });

    // 1st fetch: fails, uses fallback (isFallback = true)
    const list1 = await adapter.fetchActiveCompanyList();
    expect(list1).toBe(KFIN_VERIFIED_FALLBACK_REGISTRY);

    // Immediate second fetch: within 30s -> returns cached fallback
    const list2 = await adapter.fetchActiveCompanyList();
    expect(list2).toBe(KFIN_VERIFIED_FALLBACK_REGISTRY);

    // Enable live portal recovery
    failDiscovery = false;

    // Fast-forward time past 31 seconds
    const origNow = Date.now;
    try {
      Date.now = () => origNow() + 35 * 1000;
      // 3rd fetch: fallback TTL expired -> retries live and succeeds!
      const list3 = await adapter.fetchActiveCompanyList();
      expect(list3).not.toBe(KFIN_VERIFIED_FALLBACK_REGISTRY);
      expect(list3.length).toBe(1);
      expect(list3[0].name).toBe('TONBO IMAGING INDIA LIMITED');
    } finally {
      Date.now = origNow;
    }
  });
});
