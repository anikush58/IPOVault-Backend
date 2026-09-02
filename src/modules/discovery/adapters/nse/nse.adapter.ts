import { Injectable } from '@nestjs/common';

import { IncomingObservation } from '../../discovery.types';
import {
  NSE_SOURCE_CODE,
  ObserveContext,
  SourceAdapter,
} from '../source-adapter';
import { parseNseIpos } from './nse.parser';

@Injectable()
export class NseSourceAdapter implements SourceAdapter {
  readonly sourceCode = NSE_SOURCE_CODE;

  observe(raw: unknown, context: ObserveContext): IncomingObservation[] {
    return parseNseIpos(raw).map((parsed) => ({
      sourceId: context.sourceId,
      externalId: parsed.source.externalId,
      sourceReference: parsed.source.reference,
      companyName: parsed.company.legalName,
      rawPayload: parsed,
      discoveredAt: context.discoveredAt,
    }));
  }
}
