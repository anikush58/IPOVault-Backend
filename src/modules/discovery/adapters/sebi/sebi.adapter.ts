import { Injectable } from '@nestjs/common';

import { IncomingObservation } from '../../discovery.types';
import {
  ObserveContext,
  SEBI_SOURCE_CODE,
  SourceAdapter,
} from '../source-adapter';
import { parseSebiListingHtml } from './sebi.parser';
import { SebiFilingMetadata, SebiPdfIssueObservation } from './sebi.types';

export function sebiFilingMetadataToRawPayload(
  filing: SebiFilingMetadata,
): Record<string, unknown> {
  return {
    company: {
      legalName: filing.companyName,
      displayName: filing.companyName,
      cin: null,
    },
    ipo: {
      marketSegment: 'MAINBOARD',
      exchange: 'BOTH',
      status: 'DRAFT',
      symbol: null,
      issueSize: null,
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      faceValue: null,
      priceBandLow: null,
      priceBandHigh: null,
      lotSize: null,
      minimumLots: null,
    },
    lifecycle: {
      drhpDate: filing.filingType === 'DRHP' ? filing.filingDate : null,
      rhpDate: filing.filingType === 'RHP' ? filing.filingDate : null,
      anchorDate: null,
      openDate: null,
      closeDate: null,
      basisOfAllotmentDate: null,
      refundInitiationDate: null,
      dematCreditDate: null,
      listingDate: null,
    },
    source: {
      externalId: filing.externalId,
      reference: filing.detailUrl,
      filingType: filing.filingType,
      relationship: filing.filingRelationship,
    },
  };
}

export function sebiPdfObservationToRawPayload(
  pdfObs: SebiPdfIssueObservation,
  fallbackCompanyName?: string,
  filingDate?: string,
  filingType?: string,
): Record<string, unknown> {
  const legalName = pdfObs.legalName.value || fallbackCompanyName || '';
  return {
    company: {
      legalName,
      displayName: legalName || null,
      cin: pdfObs.cin.value || null,
    },
    ipo: {
      marketSegment: 'MAINBOARD',
      exchange: 'BOTH',
      status: 'DRAFT',
      symbol: null,
      issueSize:
        pdfObs.issueSize.value !== null ? String(pdfObs.issueSize.value) : null,
      freshIssueSize:
        pdfObs.freshIssueSize.value !== null
          ? String(pdfObs.freshIssueSize.value)
          : null,
      ofsSize:
        pdfObs.ofsSize.value !== null ? String(pdfObs.ofsSize.value) : null,
      issueShareCount:
        pdfObs.issueShareCount.value !== null
          ? String(pdfObs.issueShareCount.value)
          : null,
      freshIssueShareCount:
        pdfObs.freshIssueShareCount.value !== null
          ? String(pdfObs.freshIssueShareCount.value)
          : null,
      ofsShareCount:
        pdfObs.ofsShareCount.value !== null
          ? String(pdfObs.ofsShareCount.value)
          : null,
      faceValue:
        pdfObs.faceValue.value !== null ? String(pdfObs.faceValue.value) : null,
      priceBandLow:
        pdfObs.priceBandLow.value !== null
          ? String(pdfObs.priceBandLow.value)
          : null,
      priceBandHigh:
        pdfObs.priceBandHigh.value !== null
          ? String(pdfObs.priceBandHigh.value)
          : null,
      lotSize: pdfObs.lotSize.value !== null ? pdfObs.lotSize.value : null,
      minimumLots: null,
    },
    lifecycle: {
      drhpDate: filingDate || null,
      rhpDate: null,
      anchorDate: null,
      openDate: pdfObs.issueOpenDate.value || null,
      closeDate: pdfObs.issueCloseDate.value || null,
      basisOfAllotmentDate: null,
      refundInitiationDate: null,
      dematCreditDate: null,
      listingDate: null,
    },
    source: {
      externalId: pdfObs.externalId || null,
      reference: pdfObs.sourceUrl || null,
      filingType: filingType || null,
    },
  };
}

@Injectable()
export class SebiSourceAdapter implements SourceAdapter {
  readonly sourceCode = SEBI_SOURCE_CODE;

  observe(raw: unknown, context: ObserveContext): IncomingObservation[] {
    let htmlText = '';
    if (typeof raw === 'string') {
      htmlText = raw;
    } else if (
      typeof raw === 'object' &&
      raw !== null &&
      'body' in raw &&
      typeof (raw as { body: unknown }).body === 'string'
    ) {
      htmlText = (raw as { body: string }).body;
    } else if (
      typeof raw === 'object' &&
      raw !== null &&
      'rawHtml' in raw &&
      typeof (raw as { rawHtml: unknown }).rawHtml === 'string'
    ) {
      htmlText = (raw as { rawHtml: string }).rawHtml;
    }

    const filings = parseSebiListingHtml(htmlText);

    return filings.map((parsed) => ({
      sourceId: context.sourceId,
      externalId: parsed.externalId,
      sourceReference: parsed.detailUrl,
      companyName: parsed.companyName,
      rawPayload: sebiFilingMetadataToRawPayload(parsed),
      discoveredAt: context.discoveredAt,
    }));
  }
}
