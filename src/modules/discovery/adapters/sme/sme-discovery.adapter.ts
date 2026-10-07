import { Injectable } from '@nestjs/common';
import { IncomingObservation } from '../../discovery.types';
import { ObserveContext, SourceAdapter } from '../source-adapter';
import { SmeFilingItem } from './sme-discovery.types';

export function smeFilingItemToRawPayload(item: SmeFilingItem): Record<string, unknown> {
  const legalName = item.companyName.trim();
  return {
    company: {
      legalName,
      displayName: legalName,
      cin: item.cin || null,
    },
    ipo: {
      marketSegment: 'SME',
      exchange: item.exchange || 'BSE',
      status: 'DRAFT',
      symbol: item.symbol || item.scripCode || null,
      issueSize: item.issueSize !== null && item.issueSize !== undefined ? String(item.issueSize) : null,
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      faceValue: null,
      priceBandLow: item.priceBandLow !== null && item.priceBandLow !== undefined ? String(item.priceBandLow) : null,
      priceBandHigh: item.priceBandHigh !== null && item.priceBandHigh !== undefined ? String(item.priceBandHigh) : null,
      lotSize: item.lotSize !== null && item.lotSize !== undefined ? item.lotSize : null,
      minimumLots: null,
    },
    lifecycle: {
      drhpDate: null,
      rhpDate: null,
      anchorDate: null,
      openDate: item.issueStartDate || null,
      closeDate: item.issueEndDate || null,
      basisOfAllotmentDate: null,
      refundInitiationDate: null,
      dematCreditDate: null,
      listingDate: null,
    },
    source: {
      externalId: item.externalId || item.symbol || item.scripCode || legalName,
      reference: item.sourceReference || item.documentUrl,
      documentUrl: item.documentUrl,
      prospectusUrl: item.documentUrl,
      rhpUrl: item.filingType === 'RHP' ? item.documentUrl : null,
      drhpUrl: item.filingType === 'DRHP' ? item.documentUrl : null,
      filingType: item.filingType || 'PROSPECTUS',
      filingTitle: item.filingTitle || `${legalName} SME Prospectus`,
      symbol: item.symbol || null,
      scripCode: item.scripCode || null,
      issueStartDate: item.issueStartDate || null,
      issueEndDate: item.issueEndDate || null,
    },
  };
}

@Injectable()
export class SmeSourceAdapter implements SourceAdapter {
  readonly sourceCode = 'sme';

  observe(raw: unknown, context: ObserveContext): IncomingObservation[] {
    const items = Array.isArray(raw) ? (raw as SmeFilingItem[]) : [raw as SmeFilingItem];
    return items
      .filter((item) => item && typeof item.companyName === 'string' && item.companyName.trim().length > 0)
      .map((item) => {
        const payload = smeFilingItemToRawPayload(item);
        const externalId = (item.externalId || item.symbol || item.scripCode || item.companyName).trim();
        return {
          sourceId: context.sourceId,
          externalId,
          companyName: item.companyName.trim(),
          sourceReference: item.sourceReference || item.documentUrl,
          discoveredAt: context.discoveredAt,
          rawPayload: payload,
        };
      });
  }
}
