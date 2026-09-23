import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { SkylineRegistrarAdapter } from './skyline-registrar.adapter';

describe('SkylineRegistrarAdapter Production Contract Tests', () => {
  let adapter: SkylineRegistrarAdapter;

  const mockRequest = {
    ipoId: '11111111-1111-1111-1111-111111111111',
    registrarIpoCode: '3418',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
    companyName: 'ACETECH E-COMMERCE LIMITED',
  };

  const sampleHtmlTableAllotted = `
    <html>
      <body>
        <div class="resultsec">
          <table class="table table-bordered">
            <thead>
              <tr>
                <th>Investor Name</th>
                <th>Application No</th>
                <th>DPID/ClientID</th>
                <th>Shares Applied</th>
                <th>Shares Allotted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ANISH KUMAR</td>
                <td>APP987654</td>
                <td>1208160012345678</td>
                <td>1200</td>
                <td>1200</td>
              </tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;

  const sampleHtmlTablePartial = `
    <html>
      <body>
        <div class="resultsec">
          <table class="table table-bordered">
            <thead>
              <tr>
                <th>Name</th>
                <th>App No</th>
                <th>DP ID</th>
                <th>Applied</th>
                <th>Allotted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ANISH KUMAR</td>
                <td>APP987654</td>
                <td>IN30012312345678</td>
                <td>2000</td>
                <td>1000</td>
              </tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;

  const sampleHtmlTableNotAllotted = `
    <html>
      <body>
        <div class="resultsec">
          <table class="table table-bordered">
            <thead>
              <tr>
                <th>Name</th>
                <th>App No</th>
                <th>DP ID</th>
                <th>Applied</th>
                <th>Allotted</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>ANISH KUMAR</td>
                <td>APP987654</td>
                <td>1208160012345678</td>
                <td>1000</td>
                <td>0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;

  const sampleHtmlNotFound = `
    <html>
      <body>
        <form name="display_application" action="display_application.php">
          <input type="hidden" name="csrf_token" value="abc123token" />
        </form>
        <div class="fullwidth">
          <div class="fullwidth"></div>
        </div>
      </body>
    </html>
  `;

  const sampleDropdownHtml = `
    <select name="company" id="company">
      <option value="">Select Company</option>
      <option value="3418">ACETECH E-COMMERCE LIMITED</option>
      <option value="4175">AEGEUS TECHNOLOGIES LIMITED</option>
      <option value="3460">HIGHNESS MICROELECTRONICS LIMITED</option>
    </select>
  `;

  beforeEach(() => {
    jest.restoreAllMocks();
    adapter = new SkylineRegistrarAdapter();
  });

  it('1. should parse company options from HTML select dropdown', () => {
    const options = adapter.parseCompanyOptions(sampleDropdownHtml);
    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({ code: '3418', name: 'ACETECH E-COMMERCE LIMITED' });
    expect(options[1]).toEqual({ code: '4175', name: 'AEGEUS TECHNOLOGIES LIMITED' });
    expect(options[2]).toEqual({ code: '3460', name: 'HIGHNESS MICROELECTRONICS LIMITED' });
  });

  it('2. should normalize ALLOTTED result from table HTML', () => {
    const result = adapter.parseAllotmentResultHtml(sampleHtmlTableAllotted, new Date());
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesApplied).toBe(1200);
    expect(result.sharesAllotted).toBe(1200);
    expect(result.applicantName).toBe('ANISH KUMAR');
    expect(result.rawResponseRef).toBe('APP987654');
    expect(result.sourceCode).toBe('SKYLINE');
  });

  it('3. should normalize PARTIALLY_ALLOTTED result from table HTML', () => {
    const result = adapter.parseAllotmentResultHtml(sampleHtmlTablePartial, new Date());
    expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
    expect(result.sharesApplied).toBe(2000);
    expect(result.sharesAllotted).toBe(1000);
    expect(result.applicantName).toBe('ANISH KUMAR');
  });

  it('4. should normalize NOT_ALLOTTED result from table HTML', () => {
    const result = adapter.parseAllotmentResultHtml(sampleHtmlTableNotAllotted, new Date());
    expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    expect(result.sharesApplied).toBe(1000);
    expect(result.sharesAllotted).toBe(0);
  });

  it('5. should normalize empty result HTML to APPLICATION_NOT_FOUND', () => {
    const result = adapter.parseAllotmentResultHtml(sampleHtmlNotFound, new Date());
    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(result.sourceCode).toBe('SKYLINE');
  });

  it('6. should execute 2-step checkAllotment flow and return result', async () => {
    let callCount = 0;
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Step 1: CSRF & Session init
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'set-cookie': 'PHPSESSID=dummy123; path=/' }),
          text: async () => `<input type="hidden" name="csrf_token" value="test-token-123" />`,
        } as Response);
      }
      // Step 2: Search submission
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => sampleHtmlTableAllotted,
      } as Response);
    });

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(result.sharesAllotted).toBe(1200);
    expect(result.applicantName).toBe('ANISH KUMAR');
  });

  it('7. should handle HTTP 429 rate limit safely', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers(),
        text: async () => 'Rate limit exceeded',
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.RATE_LIMITED);
    expect(result.sourceCode).toBe('SKYLINE');
  });

  it('8. should handle HTTP 500 / upstream network errors gracefully', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        text: async () => 'Error',
      } as Response),
    );

    const result = await adapter.checkAllotment(mockRequest);
    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
  });

  it('9. should resolve company code via fuzzy matching against active company list', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => sampleDropdownHtml,
      } as Response),
    );

    const resolved = await adapter.resolveRegistrarIpoCode({
      ...mockRequest,
      registrarIpoCode: undefined,
      companyName: 'ACETECH E-COMMERCE LIMITED',
    });

    expect(resolved).toBe('3418');
  });

  it('10. should support PAN, APPLICATION_NUMBER, and DP_CLIENT_ID identifier types', () => {
    expect(adapter.supportsIdentifier(AllotmentIdentifierType.PAN)).toBe(true);
    expect(adapter.supportsIdentifier(AllotmentIdentifierType.APPLICATION_NUMBER)).toBe(true);
    expect(adapter.supportsIdentifier(AllotmentIdentifierType.DP_CLIENT_ID)).toBe(true);
  });
});
