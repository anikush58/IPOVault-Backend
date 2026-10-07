import { IncomingObservation } from '../discovery.types';

export const NSE_SOURCE_CODE = 'nse';
export const SEBI_SOURCE_CODE = 'sebi';
export const BSE_SME_SOURCE_CODE = 'bse_sme';
export const BSE_SOURCE_CODE = 'bse';
export const NSE_EMERGE_SOURCE_CODE = 'nse_emerge';

export type ObserveContext = {
  sourceId: string;
  discoveredAt: Date;
};

export interface SourceAdapter {
  readonly sourceCode: string;
  observe(raw: unknown, context: ObserveContext): IncomingObservation[];
}
