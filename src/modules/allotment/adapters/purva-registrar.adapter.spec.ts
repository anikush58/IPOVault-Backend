import { AllotmentIdentifierType, AllotmentStatus } from '../allotment.types';
import { PurvaRegistrarAdapter } from './purva-registrar.adapter';

describe('PurvaRegistrarAdapter Production Contract Tests', () => {
  let adapter: PurvaRegistrarAdapter;

  const mockRequest = {
    ipoId: '11111111-1111-1111-1111-111111111111',
    registrarIpoCode: '78',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
    companyName: 'NCL RESEARCH & FIN SERV LTD',
  };

  const sampleHtmlTableAllotted = `
    <html>
      <body>
        <section class="ipo-query-section">
          <div class="results-section">
            <div class="results-table-wrapper">
              <table class="results-table">
                <thead>
                  <tr>
                    <th>Application No</th>
                    <th>Applicant Name</th>
                    <th>PAN</th>
                    <th>Shares Applied</th>
                    <th>Shares Allotted</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>APP987654</td>
                    <td>ANISH KUSHWAHA</td>
                    <td>ABCDE1234F</td>
                    <td>1000</td>
                    <td>1000</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </body>
    </html>
  `;

  const sampleHtmlTablePartial = `
    <html>
      <body>
        <section class="ipo-query-section">
          <div class="results-section">
            <div class="results-table-wrapper">
              <table class="results-table">
                <thead>
                  <tr>
                    <th>Application No</th>
                    <th>Investor Name</th>
                    <th>PAN</th>
                    <th>Shares Applied</th>
                    <th>Shares Allotted</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>APP987654</td>
                    <td>ANISH KUSHWAHA</td>
                    <td>ABCDE1234F</td>
                    <td>2000</td>
                    <td>1000</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </body>
    </html>
  `;

  const sampleHtmlTableNotAllotted = `
    <html>
      <body>
        <section class="ipo-query-section">
          <div class="results-section">
            <div class="results-table-wrapper">
              <table class="results-table">
                <thead>
                  <tr>
                    <th>Application No</th>
                    <th>Applicant Name</th>
                    <th>PAN</th>
                    <th>Shares Applied</th>
                    <th>Shares Allotted</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>APP987654</td>
                    <td>ANISH KUSHWAHA</td>
                    <td>ABCDE1234F</td>
                    <td>1000</td>
                    <td>0</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </body>
    </html>
  `;

  const sampleSelectHtml = `
    <div class="form-group">
      <label class="form-label">Select Company</label>
      <div class="form-select-wrapper">
        <select name="company_id" id="company_id" required>
          <option value="" selected disabled>Choose a company...</option>
          <option value="78">NCL Research &amp; Fin Serv Ltd</option>
          <option value="79">Manas Polymers and Energies Limited</option>
        </select>
      </div>
    </div>
  `;

  beforeEach(() => {
    adapter = new PurvaRegistrarAdapter();
  });

  describe('Metadata and Identifier Support', () => {
    it('should declare code PURVA and correct metadata', () => {
      expect(adapter.code).toBe('PURVA');
      expect(adapter.name).toBe('Purva Sharegistry');
      expect(adapter.defaultConcurrency).toBe(3);
    });

    it('should support PAN and APPLICATION_NUMBER identifiers', () => {
      expect(adapter.supportsIdentifier(AllotmentIdentifierType.PAN)).toBe(true);
      expect(
        adapter.supportsIdentifier(AllotmentIdentifierType.APPLICATION_NUMBER),
      ).toBe(true);
    });

    it('should reject DP_CLIENT_ID identifier as unsupported', async () => {
      expect(
        adapter.supportsIdentifier(AllotmentIdentifierType.DP_CLIENT_ID),
      ).toBe(false);

      const result = await adapter.checkAllotment({
        ...mockRequest,
        identifierType: AllotmentIdentifierType.DP_CLIENT_ID,
        identifierValue: '1208160012345678',
      });

      expect(result.status).toBe(AllotmentStatus.UNSUPPORTED_IDENTIFIER);
    });
  });

  describe('parseCompanyOptions', () => {
    it('should parse company options from select element', () => {
      const companies = adapter.parseCompanyOptions(sampleSelectHtml);
      expect(companies).toHaveLength(2);
      expect(companies[0]).toEqual({
        code: '78',
        name: 'NCL Research &amp; Fin Serv Ltd',
      });
      expect(companies[1]).toEqual({
        code: '79',
        name: 'Manas Polymers and Energies Limited',
      });
    });

    it('should return empty array when no select is found', () => {
      expect(adapter.parseCompanyOptions('<div>no select</div>')).toEqual([]);
    });
  });

  describe('parseAllotmentResultHtml', () => {
    it('should parse ALLOTTED status and fields correctly', () => {
      const now = new Date();
      const result = adapter.parseAllotmentResultHtml(
        sampleHtmlTableAllotted,
        now,
      );

      expect(result.status).toBe(AllotmentStatus.ALLOTTED);
      expect(result.sharesApplied).toBe(1000);
      expect(result.sharesAllotted).toBe(1000);
      expect(result.applicantName).toBe('ANISH KUSHWAHA');
      expect(result.sourceCode).toBe('PURVA');
    });

    it('should parse PARTIALLY_ALLOTTED status correctly', () => {
      const now = new Date();
      const result = adapter.parseAllotmentResultHtml(
        sampleHtmlTablePartial,
        now,
      );

      expect(result.status).toBe(AllotmentStatus.PARTIALLY_ALLOTTED);
      expect(result.sharesApplied).toBe(2000);
      expect(result.sharesAllotted).toBe(1000);
    });

    it('should parse NOT_ALLOTTED status when allotted is 0', () => {
      const now = new Date();
      const result = adapter.parseAllotmentResultHtml(
        sampleHtmlTableNotAllotted,
        now,
      );

      expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
      expect(result.sharesApplied).toBe(1000);
      expect(result.sharesAllotted).toBe(0);
    });

    it('should return APPLICATION_NOT_FOUND when "no record found" message is present', () => {
      const now = new Date();
      const html =
        '<div class="notification-message"><strong>No record found. Please re-check.</strong></div>';
      const result = adapter.parseAllotmentResultHtml(html, now);
      expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    });

    it('should return APPLICATION_NOT_FOUND when no table or results section is present', () => {
      const now = new Date();
      const html = '<html><body><div>Empty page</div></body></html>';
      const result = adapter.parseAllotmentResultHtml(html, now);
      expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    });
  });
});
