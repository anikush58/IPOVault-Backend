import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { MaashitlaRegistrarAdapter } from './maashitla-registrar.adapter';

describe('MaashitlaRegistrarAdapter Production Contract Tests', () => {
  let adapter: MaashitlaRegistrarAdapter;

  const mockRequest = {
    ipoId: '11111111-1111-1111-1111-111111111111',
    registrarIpoCode: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
  };

  const sampleCompaniesList = [
    {
      company_id: 'e4979d51-7805-4b88-aac1-db4dbf559bd1',
      company_name: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
    },
    {
      company_id: '4a4f7df8-cedd-47f5-ba76-858ccbb27037',
      company_name: 'VAMA WOVENFAB LIMITED',
    },
    {
      company_id: '94d0cb45-e9a0-426a-94a6-dff82cbaa920',
      company_name: 'MAHARAJA & SPEEDEX INDIA LIMITED',
    },
  ];

  beforeEach(() => {
    jest.restoreAllMocks();
    adapter = new MaashitlaRegistrarAdapter();
  });

  it('1. should normalize valid Maashitla ALLOTTED response', () => {
    const fixture = {
      company_name: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
      pan: 'ABCDE1234F',
      application_no: 'APP98765',
      dpid_client_id: '1201090012345678',
      name: 'ANISH KUMAR',
      shares_applied: 1000,
      shares_alloted: 1000,
    };

    const result = adapter.normalizeMaashitlaResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(1000);
    expect(result.sharesAllotted).toBe(1000);
    expect(result.applicantName).toBe('ANISH KUMAR');
    expect(result.sourceCode).toBe('MAASHITLA');
    expect(result.rawResponseRef).toBe('APP98765');
  });

  it('2. should normalize valid Maashitla PARTIALLY_ALLOTTED response', () => {
    const fixture = {
      company_name: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
      pan: 'ABCDE1234F',
      application_no: 'APP98765',
      name: 'ANISH KUMAR',
      shares_applied: 2000,
      shares_alloted: 1000,
    };

    const result = adapter.normalizeMaashitlaResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
    expect(result.sharesApplied).toBe(2000);
    expect(result.sharesAllotted).toBe(1000);
  });

  it('3. should normalize valid Maashitla NOT_ALLOTTED response', () => {
    const fixture = {
      company_name: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
      pan: 'ABCDE1234F',
      application_no: 'APP98765',
      name: 'ANISH KUMAR',
      shares_applied: 1000,
      shares_alloted: 0,
    };

    const result = adapter.normalizeMaashitlaResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesApplied).toBe(1000);
    expect(result.sharesAllotted).toBe(0);
  });

  it('4. should normalize detail/error "No records found." to APPLICATION_NOT_FOUND', () => {
    const fixture = { detail: 'No records found.' };
    const result = adapter.normalizeMaashitlaResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
  });

  it('5. should handle malformed/null response safely without throwing', () => {
    const result = adapter.normalizeMaashitlaResponse(
      null as unknown as Record<string, unknown>,
    );
    expect(result.status).toBe(AllotmentStatus.UNKNOWN);
  });

  it('6. should handle HTTP 404 from search endpoint as APPLICATION_NOT_FOUND', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ detail: 'No records found.' }),
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(result.sourceCode).toBe('MAASHITLA');
  });

  it('7. should handle HTTP 429 rate limit safely', async () => {
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

  it('8. should handle HTTP 500 / network failure safely', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('9. should handle network timeout safely', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('AbortError: Request timeout')),
      );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('10. should query AWS API Gateway directly when registrarIpoCode parameter is supplied', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          company_name: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
          pan: 'ABCDE1234F',
          application_no: '123456',
          name: 'JOHN DOE',
          shares_applied: 500,
          shares_alloted: 500,
        }),
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('execute-api.ap-south-1.amazonaws.com/prod/check/spectraa-technology-solutions-limited'),
      expect.anything(),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('pan=ABCDE1234F'),
      expect.anything(),
    );
  });

  it('11. should auto-resolve company name from active companies list', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('/company-directory')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              companies: [
                {
                  company_name: 'VAMA WOVENFAB LIMITED',
                  company_slug: 'vama-wovenfab-limited',
                },
              ],
            }),
          } as Response);
        }
        if (urlStr.includes('/public-issue/companies')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => sampleCompaniesList,
          } as Response);
        }
        if (urlStr.includes('/prod/check/vama-wovenfab-limited')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              name: 'TEST APPLICANT',
              shares_applied: 2000,
              shares_allotted: 2000,
            }),
          } as Response);
        }
        if (urlStr.includes('/public-issue/search')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              company_name: 'VAMA WOVENFAB LIMITED',
              pan: 'ABCDE1234F',
              application_no: 'APP777',
              name: 'TEST APPLICANT',
              shares_applied: 2000,
              shares_alloted: 2000,
            }),
          } as Response);
        }
        return Promise.reject(new Error(`Unexpected url ${urlStr}`));
      });

    const requestWithoutCode = {
      ipoId: '22222222-2222-2222-2222-222222222222',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Vama Wovenfab Limited',
      companyName: 'Vama Wovenfab',
    };

    const result = await adapter.checkAllotment(requestWithoutCode);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.applicantName).toBe('TEST APPLICANT');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('vama-wovenfab-limited'),
      expect.anything(),
    );
  });

  it('12. should return NOT_YET_AVAILABLE when company is not found in active list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => sampleCompaniesList,
      } as Response),
    );

    const unlistedRequest = {
      ipoId: '33333333-3333-3333-3333-333333333333',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyLegalName: 'Nonexistent Enterprise Limited',
    };

    const result = await adapter.checkAllotment(unlistedRequest);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    expect(result.sourceCode).toBe('MAASHITLA');
  });

  it('13. should support application number search query parameter', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          company_name: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
          pan: 'ABCDE1234F',
          application_no: 'APP123',
          name: 'JOHN DOE',
          shares_applied: 100,
          shares_alloted: 100,
        }),
      } as Response),
    );

    const appRequest = {
      ipoId: '11111111-1111-1111-1111-111111111111',
      registrarIpoCode: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
      identifierType: AllotmentIdentifierType.APPLICATION_NUMBER,
      identifierValue: 'APP123',
    };

    const result = await adapter.checkAllotment(appRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('application_no=APP123'),
      expect.anything(),
    );
  });

  it('14. should normalize wrapper object structure with nested data object', () => {
    const fixture = {
      success: true,
      data: {
        company_name: 'SHIVCHEM AGRO LIMITED',
        pan: 'ABCDE1234F',
        name: 'ANISH KUMAR',
        shares_applied: 2000,
        shares_alloted: 2000,
      },
    };

    const result = adapter.normalizeMaashitlaResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(2000);
    expect(result.sharesAllotted).toBe(2000);
    expect(result.applicantName).toBe('ANISH KUMAR');
  });

  it('15. should recognize "basis of allotment in process" as NOT_YET_AVAILABLE', () => {
    const fixture = {
      status: 'error',
      message: 'Basis of allotment is in process. Please check back later.',
    };

    const result = adapter.normalizeMaashitlaResponse(fixture);
    expect(result.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    expect(result.sourceCode).toBe('MAASHITLA');
  });

  it('16. should discover companies from wrapper structure { data: [...] }', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            { company_name: 'SHIVCHEM AGRO LIMITED' },
            { company_name: 'ACME UNIVERSAL SAFEZONE 9 LIMITED' },
          ],
        }),
      } as Response),
    );

    const list = await adapter.fetchActiveCompanyList();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('SHIVCHEM AGRO LIMITED');
    expect(list[1].name).toBe('ACME UNIVERSAL SAFEZONE 9 LIMITED');
  });

  it('17. should discover and match Wiscon Industries from /company-directory', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('/company-directory')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            companies: [
              {
                company_name: 'WISCON INDUSTRIES LIMITED',
                company_slug: 'wiscon-industries-limited',
              },
            ],
          }),
        } as Response);
      }
      if (urlStr.includes('/prod/check/wiscon-industries-limited')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            name: 'WISCON INVESTOR',
            shares_applied: 1200,
            shares_allotted: 1200,
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const wisconReq = {
      ipoId: '39cdd3fe-8455-47ad-98e6-497d1249abc9',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
      companyName: 'Wiscon Industries',
      companyLegalName: 'Wiscon Industries Limited',
    };

    const resolved = await adapter.resolveRegistrarIpoCode(wisconReq);
    expect(resolved).toBe('wiscon-industries-limited');

    const result = await adapter.checkAllotment(wisconReq);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.applicantName).toBe('WISCON INVESTOR');
    expect(result.sharesAllotted).toBe(1200);
  });

  it('18. should handle empty object {} from AWS gateway as APPLICATION_NOT_FOUND', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
  });
});
