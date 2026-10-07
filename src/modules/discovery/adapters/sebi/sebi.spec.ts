import { ConfigService } from '@nestjs/config';
import { DiscoveryStatus } from '@prisma/client';

import { Env } from '../../../../config/env';
import { PrismaService } from '../../../../database/prisma.service';
import { DiscoveryService } from '../../discovery.service';
import { DiscoveryRecordRepository } from '../../discovery-record.repository';
import { SebiSourceAdapter } from './sebi.adapter';
import { SebiDiscoveryFlow } from './sebi-discovery.flow';
import {
  downloadSebiDocument,
  fetchSebiListing,
  isOfficialSebiUrl,
  resolveSebiPdfUrlFromHtml,
  SebiFetchError,
  SebiHttpClient,
  SebiPdfSizeExceededError,
} from './sebi.fetcher';
import {
  classifySebiFilingType,
  extractCompanyNameFromTitle,
  inferSebiFilingRelationship,
  parseSebiListingHtml,
  SebiParseError,
} from './sebi.parser';

describe('SEBI Official Filing Ingestion Foundation', () => {
  const mockSebiListingHtml = `
    <input type='hidden' name='totalpage' value=234 />
    <table class='table table-striped table-bordered table-hover bordered fix_table dataTable no-footer'>
      <thead>
        <tr><th style='width:18%'>Date</th><th>Title</th></tr>
      </thead>
      <tr class='odd'>
        <td>Sep 08, 2026</td>
        <td>
          <a href='https://www.sebi.gov.in/filings/public-issues/sep-2026/jindal-supreme-india-limited-rhp_104328.html' target="_blank" title="Jindal Supreme (India) Limited - RHP<br><a href= 'https://www.sebi.gov.in/sebi_data/commondocs/sep-2026/Jindal%20Supreme%20(India)%20Limited%20-%20AP_p.PDF'>Jindal Supreme (India) Limited - Abridged Prospectus</a>" class='points'>
            Jindal Supreme (India) Limited - RHP<br><a href= 'https://www.sebi.gov.in/sebi_data/commondocs/sep-2026/Jindal%20Supreme%20(India)%20Limited%20-%20AP_p.PDF'>Jindal Supreme (India) Limited - Abridged Prospectus</a>
          </a>
        </td>
      </tr>
      <tr class='odd'>
        <td>Sep 07, 2026</td>
        <td>
          <a href='https://www.sebi.gov.in/filings/public-issues/sep-2026/prasol-chemicals-limited-addendum-to-rhp_104322.html' target="_blank" title="Prasol Chemicals Limited - Addendum to RHP" class='points'>
            Prasol Chemicals Limited - Addendum to RHP
          </a>
        </td>
      </tr>
    </table>
  `;

  describe('URL Security & Validation (Test 7 & 8)', () => {
    it('7. validates official SEBI, NSE, BSE PDF/document URLs', () => {
      expect(
        isOfficialSebiUrl('https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/12345.pdf'),
      ).toBe(true);
      expect(
        isOfficialSebiUrl('https://sebi.gov.in/filings/public-issues/doc.pdf'),
      ).toBe(true);
      expect(
        isOfficialSebiUrl('https://www.bseindia.com/downloads/ipo/prospectus.pdf'),
      ).toBe(true);
      expect(
        isOfficialSebiUrl('https://nsearchives.nseindia.com/emerge/rhp.pdf'),
      ).toBe(true);
    });

    it('8. rejects non-authoritative third-party document URLs', () => {
      expect(isOfficialSebiUrl('https://malicious-site.com/sebi_doc.pdf')).toBe(false);
      expect(isOfficialSebiUrl('http://www.sebi.gov.in.attacker.com/doc.pdf')).toBe(false);
      expect(isOfficialSebiUrl('ftp://www.sebi.gov.in/doc.pdf')).toBe(false);
      expect(isOfficialSebiUrl('https://ipowatch.in/acme_drhp.pdf')).toBe(false);
      expect(isOfficialSebiUrl('https://chittorgarh.com/documents/drhp.pdf')).toBe(false);
    });

    it('validates verified issuer-hosted official DRHP/RHP URLs when domain matches and path is a prospectus', () => {
      const issuerUrl = 'https://acmeindia.co/assets/web/pdf/DRHP_Acme_20250930201943.pdf';
      const issuerWebsite = 'https://acmeindia.co';

      // Accepted with matching company website
      expect(isOfficialSebiUrl(issuerUrl, issuerWebsite)).toBe(true);
      expect(isOfficialSebiUrl(issuerUrl, 'acmeindia.co')).toBe(true);
      expect(isOfficialSebiUrl(issuerUrl, 'www.acmeindia.co')).toBe(true);

      // Subdomain issuer match
      expect(
        isOfficialSebiUrl(
          'https://investor.acmeindia.co/filings/RHP_Acme.pdf',
          'https://acmeindia.co',
        ),
      ).toBe(true);
    });

    it('rejects issuer-hosted non-prospectus documents or mismatched domains', () => {
      // Non-prospectus document on issuer domain
      expect(
        isOfficialSebiUrl(
          'https://acmeindia.co/assets/web/pdf/product_brochure.pdf',
          'https://acmeindia.co',
        ),
      ).toBe(false);

      // Mismatched domain
      expect(
        isOfficialSebiUrl(
          'https://anothercompany.co/assets/web/pdf/DRHP_Acme.pdf',
          'https://acmeindia.co',
        ),
      ).toBe(false);

      // Third party aggregator even if company website is provided
      expect(
        isOfficialSebiUrl(
          'https://ipowatch.in/assets/DRHP_Acme.pdf',
          'https://acmeindia.co',
        ),
      ).toBe(false);
    });

    it('rejects downloading from non-SEBI URL without valid issuer match', async () => {
      await expect(
        downloadSebiDocument('https://attacker.com/file.pdf'),
      ).rejects.toThrow('Security error');
    });
  });

  describe('Parser (Test 1, 2, 3, 4, 5)', () => {
    it('1 & 2 & 3. parses valid SEBI listing response and extracts filing metadata & official document URL', () => {
      const filings = parseSebiListingHtml(mockSebiListingHtml);
      expect(filings.length).toBe(2);

      const jindal = filings[0]!;
      expect(jindal.externalId).toBe('104328');
      expect(jindal.companyName).toBe('Jindal Supreme India Limited');
      expect(jindal.filingType).toBe('RHP');
      expect(jindal.filingDate).toBe('2026-09-08');
      expect(jindal.detailUrl).toBe(
        'https://www.sebi.gov.in/filings/public-issues/sep-2026/jindal-supreme-india-limited-rhp_104328.html',
      );
      expect(jindal.documentUrl).toBe(
        'https://www.sebi.gov.in/sebi_data/commondocs/sep-2026/Jindal%20Supreme%20(India)%20Limited%20-%20AP_p.PDF',
      );

      const prasol = filings[1]!;
      expect(prasol.externalId).toBe('104322');
      expect(prasol.companyName).toBe('Prasol Chemicals Limited');
      expect(prasol.filingType).toBe('ADDENDUM');
      expect(prasol.documentUrl).toBeUndefined();
    });

    it('classifies filing types accurately (Phase 7A)', () => {
      expect(classifySebiFilingType('ABC Limited - DRHP')).toBe('DRHP');
      expect(classifySebiFilingType('XYZ Corp - RHP')).toBe('RHP');
      expect(classifySebiFilingType('PQR Ltd - Prospectus')).toBe('PROSPECTUS');
      expect(classifySebiFilingType('LMN Ltd - Abridged Prospectus')).toBe('ABRIDGED_PROSPECTUS');
      expect(classifySebiFilingType('EFG Ltd - Addendum')).toBe('ADDENDUM');
      expect(classifySebiFilingType('HIJ Ltd - Corrigendum')).toBe('CORRIGENDUM');
      expect(classifySebiFilingType('Jindal Ltd - Price Band Advertisement')).toBe('PRICE_BAND_ADVERTISEMENT');
      expect(classifySebiFilingType('NOP Ltd - General Announcement')).toBe('OTHER');
    });

    it('infers filing relationships deterministically (Phase 7A)', () => {
      const rhpRel = inferSebiFilingRelationship('RHP', 'Jindal Supreme (India) Limited');
      expect(rhpRel.parentFilingType).toBe('DRHP');
      expect(rhpRel.relationshipType).toBe('SUPERSEDES_DRHP');

      const pbRel = inferSebiFilingRelationship('PRICE_BAND_ADVERTISEMENT', 'Jindal Supreme Limited');
      expect(pbRel.parentFilingType).toBe('RHP');
      expect(pbRel.relationshipType).toBe('AMENDS_RHP');

      const addRel = inferSebiFilingRelationship('ADDENDUM', 'Prasol Chemicals Limited');
      expect(addRel.parentFilingType).toBe('RHP');
      expect(addRel.relationshipType).toBe('SUPPLEMENTS_RHP');

      const otherRel = inferSebiFilingRelationship('OTHER', 'General Announcement');
      expect(otherRel.parentFilingType).toBeNull();
      expect(otherRel.relationshipType).toBe('UNRESOLVED');
    });

    it('extracts clean company name from filing title', () => {
      expect(extractCompanyNameFromTitle('Jindal Supreme (India) Limited - RHP')).toBe(
        'Jindal Supreme India Limited',
      );
      expect(extractCompanyNameFromTitle('Hero Motors Limited - Corrigendum to Addendum.')).toBe(
        'Hero Motors Limited',
      );
    });

    it('4. throws SebiParseError for malformed listing HTML', () => {
      expect(() => parseSebiListingHtml('')).toThrow(SebiParseError);
    });

    it('5. returns empty array for empty table HTML', () => {
      const emptyHtml = '<table class="table"><tr><th>Date</th></tr></table>';
      const filings = parseSebiListingHtml(emptyHtml);
      expect(filings.length).toBe(0);
    });
  });

  describe('Fetcher & HTTP Client (Test 6, 10, 11)', () => {
    it('6. handles non-2xx HTTP status gracefully', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        fetchSebiListing({
          endpoint: 'https://www.sebi.gov.in/test',
          fetchImpl: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow(SebiFetchError);
    });

    it('handles HTTP timeout', async () => {
      const mockFetch = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          }, 50);
        });
      });

      await expect(
        fetchSebiListing({
          endpoint: 'https://www.sebi.gov.in/test',
          timeoutMs: 10,
          fetchImpl: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow('timed out');
    });

    it('10. handles document download failure', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve('Not Found'),
      });

      await expect(
        downloadSebiDocument(
          'https://www.sebi.gov.in/missing.pdf',
          mockFetch as unknown as typeof fetch,
        ),
      ).rejects.toThrow('failed with status 404');
    });

    it('11. captures content type and byte length for downloaded document', async () => {
      const fakePdfBytes = Buffer.from('%PDF-1.4 Fake PDF Content');
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: () =>
          Promise.resolve(
            fakePdfBytes.buffer.slice(
              fakePdfBytes.byteOffset,
              fakePdfBytes.byteOffset + fakePdfBytes.byteLength,
            ),
          ),
      });

      const res = await downloadSebiDocument(
        'https://www.sebi.gov.in/test.pdf',
        mockFetch as unknown as typeof fetch,
      );

      expect(res.status).toBe(200);
      expect(res.contentType).toBe('application/pdf');
      expect(res.contentLength).toBe(fakePdfBytes.length);
    });
  });

  describe('SebiDiscoveryFlow Ingestion (Test 9, 12, 13)', () => {
    let flow: SebiDiscoveryFlow;
    let mockPrisma: Record<string, Record<string, jest.Mock>>;
    let mockRecordsRepo: Record<string, jest.Mock>;
    let mockClient: SebiHttpClient;

    beforeEach(() => {
      mockPrisma = {
        source: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sebi-source-id',
            code: 'sebi',
          }),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
        company: {
          create: jest.fn(),
        },
        ipo: {
          create: jest.fn(),
        },
      };

      mockRecordsRepo = {
        findDuplicate: jest.fn().mockResolvedValue(null),
        findProcessedRecord: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((obs) =>
          Promise.resolve({
            id: `record-${obs.externalId}`,
            status: DiscoveryStatus.NEW,
          }),
        ),
        mark: jest.fn().mockResolvedValue({}),
      };

      const mockConfig = {
        get: jest.fn().mockReturnValue('https://www.sebi.gov.in/ajax'),
      } as unknown as ConfigService<Env, true>;

      mockClient = new SebiHttpClient(mockConfig);
      const mockAdapter = new SebiSourceAdapter();

      const mockDiscoveryService = {
        process: jest.fn().mockResolvedValue({ outcome: 'CREATED', discoveryRecordId: 'rec-1', ipoId: 'ipo-1' }),
      };

      flow = new SebiDiscoveryFlow(
        mockPrisma as unknown as PrismaService,
        mockRecordsRepo as unknown as DiscoveryRecordRepository,
        mockClient,
        mockAdapter,
        mockDiscoveryService as unknown as DiscoveryService,
      );
    });

    it('9. handles duplicate filings idempotently without creating extra discovery records', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      mockRecordsRepo.findDuplicate.mockResolvedValue({ id: 'existing-dup-id' });

      const result = await flow.run(1, mockFetch as unknown as typeof fetch);

      expect(result.totalDiscovered).toBe(2);
      expect(result.duplicateCount).toBe(2);
      expect(result.createdRecordsCount).toBe(0);
      expect(mockRecordsRepo.create).not.toHaveBeenCalled();
    });

    it('12 & 13. creates DiscoveryRecords for new filings WITHOUT creating canonical Company or Ipo records', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      const result = await flow.run(1, mockFetch as unknown as typeof fetch);

      expect(result.totalDiscovered).toBe(2);
      expect(result.createdRecordsCount).toBe(2);
      expect(result.duplicateCount).toBe(0);
      expect(mockRecordsRepo.create).toHaveBeenCalledTimes(2);

      // Verify NO canonical creation
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipo.create).not.toHaveBeenCalled();
    });

    it('14 (Phase 4). updates source health to HEALTHY on successful ingestion run', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      await flow.run(1, mockFetch as unknown as typeof fetch);

      expect(mockPrisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sebi-source-id' },
          data: expect.objectContaining({
            healthStatus: 'HEALTHY',
          }),
        }),
      );
    });

    it('15 (Phase 4). skips downloading PDF when pre-download check finds already-processed record', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      mockRecordsRepo.findProcessedRecord.mockResolvedValue({ id: 'processed-rec-1' });

      const result = await flow.run(1, mockFetch as unknown as typeof fetch, true);

      expect(result.downloadedDocumentsCount).toBe(0);
      expect(result.skippedDocumentsCount).toBe(2);
      expect(mockRecordsRepo.findProcessedRecord).toHaveBeenCalledTimes(2);
    });

    it('16 (Phase 6). rejects PDF download when Content-Length exceeds maximum allowed size', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: { get: (h: string) => (h === 'content-length' ? '60000000' : 'application/pdf') },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      });

      await expect(
        downloadSebiDocument(
          'https://www.sebi.gov.in/doc.pdf',
          mockFetch as unknown as typeof fetch,
          1000,
          50_000_000,
        ),
      ).rejects.toThrow(SebiPdfSizeExceededError);
    });

    it('17 (Phase 6). allows PDF download when Content-Length is within maximum allowed size', async () => {
      const samplePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: { get: (h: string) => (h === 'content-length' ? '1000' : 'application/pdf') },
        arrayBuffer: () => Promise.resolve(samplePdfBytes.buffer),
      });

      const res = await downloadSebiDocument(
        'https://www.sebi.gov.in/doc.pdf',
        mockFetch as unknown as typeof fetch,
        1000,
        50_000_000,
      );

      expect(res.contentLength).toBe(4);
    });

    it('18 (Phase 6). updates source health to DEGRADED when PDF parsing fails for a filing', async () => {
      const mockFetch = jest.fn().mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('ajax')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve(mockSebiListingHtml),
          });
        }
        return Promise.resolve({
          status: 200,
          headers: { get: () => 'application/pdf' },
          arrayBuffer: () => Promise.resolve(Buffer.from('not-a-valid-pdf').buffer),
        });
      });

      const result = await flow.run(1, mockFetch as unknown as typeof fetch, true);

      expect(result.failedDownloadsCount).toBeGreaterThan(0);
      expect(mockPrisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sebi-source-id' },
          data: expect.objectContaining({
            healthStatus: 'DEGRADED',
          }),
        }),
      );
    });

    it('19 (Phase 6). applies inter-request delay between consecutive PDF downloads but not before the first download', async () => {
      const twoPdfListingHtml = `
        <input type='hidden' name='totalpage' value=1 />
        <table class='table'>
          <tr class='odd'>
            <td>Sep 08, 2026</td>
            <td><a href='https://www.sebi.gov.in/filings/public-issues/sep-2026/company-a-rhp_1001.html' class='points' title="Company A Limited - RHP<br><a href= 'https://www.sebi.gov.in/sebi_data/commondocs/sep-2026/CompanyA.PDF'>Doc A</a>">Company A Limited - RHP</a></td>
          </tr>
          <tr class='odd'>
            <td>Sep 07, 2026</td>
            <td><a href='https://www.sebi.gov.in/filings/public-issues/sep-2026/company-b-rhp_1002.html' class='points' title="Company B Limited - RHP<br><a href= 'https://www.sebi.gov.in/sebi_data/commondocs/sep-2026/CompanyB.PDF'>Doc B</a>">Company B Limited - RHP</a></td>
          </tr>
        </table>
      `;

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const mockFetch = jest.fn().mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('ajax')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve(twoPdfListingHtml),
          });
        }
        return Promise.resolve({
          status: 200,
          headers: { get: () => 'application/pdf' },
          arrayBuffer: () => Promise.resolve(Buffer.from('%PDF-1.4 Fake PDF Data').buffer),
        });
      });

      const delayMs = 150;
      const result = await flow.run(1, mockFetch as unknown as typeof fetch, true, true, delayMs);

      expect(result.downloadedDocumentsCount).toBe(2);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), delayMs);

      setTimeoutSpy.mockRestore();
    });

    it('20 (Phase 6). skips inter-request delay when filings are skipped as already processed', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      mockRecordsRepo.findProcessedRecord.mockResolvedValue({ id: 'processed-rec-1' });

      const delayMs = 200;
      const result = await flow.run(1, mockFetch as unknown as typeof fetch, true, true, delayMs);

      expect(result.downloadedDocumentsCount).toBe(0);
      expect(result.skippedDocumentsCount).toBe(2);

      const delayCalls = setTimeoutSpy.mock.calls.filter((call) => call[1] === delayMs);
      expect(delayCalls.length).toBe(0);

      setTimeoutSpy.mockRestore();
    });

    it('21 (Phase 6). skips inter-request delay when downloadDocument is false', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      const delayMs = 200;
      const result = await flow.run(1, mockFetch as unknown as typeof fetch, false, true, delayMs);

      expect(result.downloadedDocumentsCount).toBe(0);

      const delayCalls = setTimeoutSpy.mock.calls.filter((call) => call[1] === delayMs);
      expect(delayCalls.length).toBe(0);

      setTimeoutSpy.mockRestore();
    });

    it('22 (Phase 7A). executes multi-page discovery, aggregates statistics, and stops on empty page', async () => {
      const mockFetch = jest.fn().mockImplementation((_url, opts) => {
        const bodyStr = String(opts?.body || '');
        if (bodyStr.includes('nextValue=1')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve(mockSebiListingHtml),
          });
        }
        if (bodyStr.includes('nextValue=2')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve('<table class="table"><tr><th>Date</th></tr></table>'),
          });
        }
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve(mockSebiListingHtml),
        });
      });

      const result = await flow.run(1, 3, mockFetch as unknown as typeof fetch);

      expect(result.totalDiscovered).toBe(2);
      expect(result.createdRecordsCount).toBe(2);
    });

    it('23 (Phase 7A). isolates page failure in multi-page flow and updates health status to DEGRADED', async () => {
      const mockFetch = jest.fn().mockImplementation((_url, opts) => {
        const bodyStr = String(opts?.body || '');
        if (bodyStr.includes('nextValue=1')) {
          return Promise.resolve({
            status: 200,
            text: () => Promise.resolve(mockSebiListingHtml),
          });
        }
        return Promise.reject(new Error('Network error on page 2'));
      });

      const result = await flow.run(1, 2, mockFetch as unknown as typeof fetch);

      expect(result.totalDiscovered).toBe(2);
      expect(mockPrisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sebi-source-id' },
          data: expect.objectContaining({
            healthStatus: 'DEGRADED',
          }),
        }),
      );
    });

    it('processes SEBI listing observations through DiscoveryService even without PDF download', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(mockSebiListingHtml),
      });

      const mockDiscoverySvc = flow['discoveryService'] as any;

      await flow.run(1, mockFetch as unknown as typeof fetch, false, true);

      expect(mockDiscoverySvc.process).toHaveBeenCalledTimes(2);
    });
  });

  describe('SEBI Detail HTML -> PDF Resolution (Phase 31.1 Part A)', () => {
    const baseUrl = 'https://www.sebi.gov.in/filings/public-issues/sep-2026/sample_1001.html';

    it('resolves iframe PDF URL from HTML detail page', () => {
      const html = `<html><body><iframe src="https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/12345.pdf"></iframe></body></html>`;
      const resolved = resolveSebiPdfUrlFromHtml(html, baseUrl);
      expect(resolved).toBe('https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/12345.pdf');
    });

    it('resolves relative anchor PDF URL from HTML detail page', () => {
      const html = `<html><body><a href="/sebi_data/attachdocs/sep-2026/67890.pdf">Download RHP</a></body></html>`;
      const resolved = resolveSebiPdfUrlFromHtml(html, baseUrl);
      expect(resolved).toBe('https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/67890.pdf');
    });

    it('resolves absolute anchor PDF URL', () => {
      const html = `<html><body><a href="https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/67890.pdf">Link</a></body></html>`;
      const resolved = resolveSebiPdfUrlFromHtml(html, baseUrl);
      expect(resolved).toBe('https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/67890.pdf');
    });

    it('returns null when HTML contains no PDF links', () => {
      const html = `<html><body><p>No document attached to this filing page.</p></body></html>`;
      const resolved = resolveSebiPdfUrlFromHtml(html, baseUrl);
      expect(resolved).toBeNull();
    });

    it('rejects external/non-SEBI PDF URLs embedded in HTML', () => {
      const html = `<html><body><iframe src="https://external-malicious-site.com/doc.pdf"></iframe></body></html>`;
      const resolved = resolveSebiPdfUrlFromHtml(html, baseUrl);
      expect(resolved).toBeNull();
    });

    it('handles malformed HTML gracefully without throwing', () => {
      expect(resolveSebiPdfUrlFromHtml('', baseUrl)).toBeNull();
      expect(resolveSebiPdfUrlFromHtml('<<<invalid html>>>', baseUrl)).toBeNull();
    });
  });
});
