import { Injectable } from '@nestjs/common';

import { IncomingObservation } from '../../discovery.types';
import {
  ObserveContext,
  SEBI_SOURCE_CODE,
  SourceAdapter,
} from '../source-adapter';
import { parseSebiListingHtml } from './sebi.parser';

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
      rawPayload: parsed,
      discoveredAt: context.discoveredAt,
    }));
  }
}
