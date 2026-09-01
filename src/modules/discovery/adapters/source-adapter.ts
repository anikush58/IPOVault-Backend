import { IncomingObservation } from '../discovery.types';

export const NSE_SOURCE_CODE = 'nse';

export type ObserveContext = {
  sourceId: string;
  discoveredAt: Date;
};

export interface SourceAdapter {
  readonly sourceCode: string;
  observe(raw: unknown, context: ObserveContext): IncomingObservation;
}
