import { Injectable, Logger } from '@nestjs/common';
import { isAuthoritativeDocumentUrl } from '../sebi/sebi.fetcher';
import { SmeFilingItem } from './sme-discovery.types';

@Injectable()
export class SmeDiscoveryFetcher {
  private readonly logger = new Logger(SmeDiscoveryFetcher.name);

  /**
   * Fetches official BSE SME public issue filings.
   */
  async fetchBseSmeFilings(fetchImpl?: typeof fetch): Promise<SmeFilingItem[]> {
    const doFetch = fetchImpl || fetch;
    const url = 'https://api.bseindia.com/BseIndiaAPI/api/GetIssueMaster/w?status=C&segment=SME';

    try {
      const response = await doFetch(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.bseindia.com/',
        },
      });

      if (!response.ok) {
        this.logger.warn(`BSE SME endpoint returned status ${response.status}`);
        return [];
      }

      const data = await response.json();
      return this.parseBseApiResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to fetch BSE SME filings: ${msg}`);
      return [];
    }
  }

  /**
   * Fetches official NSE Emerge public issue filings.
   */
  async fetchNseEmergeFilings(fetchImpl?: typeof fetch): Promise<SmeFilingItem[]> {
    const doFetch = fetchImpl || fetch;
    const url = 'https://www.nseindia.com/api/ipo-current-issue';

    try {
      const response = await doFetch(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.nseindia.com/',
        },
      });

      if (!response.ok) {
        this.logger.warn(`NSE Emerge endpoint returned status ${response.status}`);
        return [];
      }

      const data = await response.json();
      return this.parseNseApiResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to fetch NSE Emerge filings: ${msg}`);
      return [];
    }
  }

  /**
   * Parses BSE API/HTML response and filters for valid authoritative document URLs.
   */
  parseBseApiResponse(data: any): SmeFilingItem[] {
    if (!data) return [];
    const items: any[] = Array.isArray(data) ? data : data.Table || data.issues || [];
    const results: SmeFilingItem[] = [];

    for (const raw of items) {
      const companyName = raw.CompanyName || raw.companyName || raw.IssueName || raw.issueName || raw.name;
      if (!companyName || typeof companyName !== 'string' || companyName.trim().length === 0) {
        continue;
      }

      const docUrl = raw.DocumentUrl || raw.documentUrl || raw.prospectusUrl || raw.ProspectusUrl || raw.doc_url || raw.DraftProspectusUrl;
      if (!docUrl || typeof docUrl !== 'string' || !isAuthoritativeDocumentUrl(docUrl.trim())) {
        continue;
      }

      results.push({
        companyName: companyName.trim(),
        marketSegment: 'SME',
        exchange: 'BSE',
        documentUrl: docUrl.trim(),
        filingType: docUrl.toLowerCase().includes('rhp') ? 'RHP' : 'PROSPECTUS',
        filingTitle: raw.IssueName || raw.FilingTitle || `${companyName.trim()} BSE SME Prospectus`,
        symbol: raw.SecurityId || raw.scripCode || raw.symbol || null,
        scripCode: raw.ScripCode || raw.scripCode || null,
        issueStartDate: raw.StartDate || raw.issueStartDate || null,
        issueEndDate: raw.EndDate || raw.issueEndDate || null,
        issueSize: raw.IssueSize || raw.issueSize || null,
        externalId: raw.ScripCode || raw.SecurityId || raw.IssueId || companyName.trim(),
        sourceReference: raw.DetailUrl || docUrl.trim(),
      });
    }

    return results;
  }

  /**
   * Parses NSE API response and filters for valid authoritative document URLs on NSE Emerge.
   */
  parseNseApiResponse(data: any): SmeFilingItem[] {
    if (!data) return [];
    const items: any[] = Array.isArray(data) ? data : data.data || data.issues || [];
    const results: SmeFilingItem[] = [];

    for (const raw of items) {
      const isSme =
        raw.series === 'SM' ||
        raw.marketType === 'SME' ||
        raw.isSme === true ||
        (raw.issueType && raw.issueType.toUpperCase().includes('SME')) ||
        (raw.symbol && raw.symbol.endsWith('SME'));

      if (!isSme) {
        continue;
      }

      const companyName = raw.companyName || raw.company || raw.issueName || raw.name;
      if (!companyName || typeof companyName !== 'string' || companyName.trim().length === 0) {
        continue;
      }

      const docUrl = raw.prospectusUrl || raw.documentUrl || raw.rhpUrl || raw.drhpUrl || raw.fileUrl;
      if (!docUrl || typeof docUrl !== 'string' || !isAuthoritativeDocumentUrl(docUrl.trim())) {
        continue;
      }

      results.push({
        companyName: companyName.trim(),
        marketSegment: 'SME',
        exchange: 'NSE',
        documentUrl: docUrl.trim(),
        filingType: docUrl.toLowerCase().includes('rhp') ? 'RHP' : 'PROSPECTUS',
        filingTitle: raw.issueName || `${companyName.trim()} NSE Emerge Prospectus`,
        symbol: raw.symbol || null,
        issueStartDate: raw.issueStartDate || raw.startDate || null,
        issueEndDate: raw.issueEndDate || raw.endDate || null,
        issueSize: raw.issueSize || null,
        externalId: raw.symbol || companyName.trim(),
        sourceReference: docUrl.trim(),
      });
    }

    return results;
  }
}
