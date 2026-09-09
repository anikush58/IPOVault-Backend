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
  SebiFetchError,
  SebiHttpClient,
} from './sebi.fetcher';
import {
  classifySebiFilingType,
  extractCompanyNameFromTitle,
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
    it('7. validates official SEBI PDF/document URLs', () => {
      expect(
        isOfficialSebiUrl('https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/12345.pdf'),
      ).toBe(true);
      expect(
        isOfficialSebiUrl('https://sebi.gov.in/filings/public-issues/doc.pdf'),
      ).toBe(true);
    });

    it('8. rejects non-SEBI document URLs', () => {
      expect(isOfficialSebiUrl('https://malicious-site.com/sebi_doc.pdf')).toBe(false);
      expect(isOfficialSebiUrl('http://www.sebi.gov.in.attacker.com/doc.pdf')).toBe(false);
      expect(isOfficialSebiUrl('ftp://www.sebi.gov.in/doc.pdf')).toBe(false);
    });

    it('rejects downloading from non-SEBI URL', async () => {
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

    it('classifies filing types accurately', () => {
      expect(classifySebiFilingType('ABC Limited - DRHP')).toBe('DRHP');
      expect(classifySebiFilingType('XYZ Corp - RHP')).toBe('RHP');
      expect(classifySebiFilingType('PQR Ltd - Prospectus')).toBe('PROSPECTUS');
      expect(classifySebiFilingType('LMN Ltd - Abridged Prospectus')).toBe('ABRIDGED_PROSPECTUS');
      expect(classifySebiFilingType('EFG Ltd - Addendum')).toBe('ADDENDUM');
      expect(classifySebiFilingType('HIJ Ltd - Corrigendum')).toBe('CORRIGENDUM');
      expect(classifySebiFilingType('NOP Ltd - General Announcement')).toBe('UNKNOWN');
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
  });
});
