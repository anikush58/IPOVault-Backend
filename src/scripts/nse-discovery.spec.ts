import { NseDiscoveryFlow } from '../modules/discovery/nse-discovery.flow';
import { DiscoveryProcessResult } from '../modules/discovery/discovery.types';
import { formatNseLiveIngestSummary, runNseLiveIngest } from './nse-discovery';

describe('NSE live discovery runner', () => {
  it('formats a concise ingest summary', () => {
    const results: DiscoveryProcessResult[] = [
      {
        outcome: 'CREATED',
        discoveryRecordId: 'rec-1',
        ipoId: 'ipo-1',
      },
      {
        outcome: 'DUPLICATE',
        discoveryRecordId: 'rec-2',
        ipoId: null,
      },
    ];

    expect(formatNseLiveIngestSummary(results)).toBe(
      [
        'NSE live ingest: 2 result(s)',
        '- CREATED discoveryRecordId=rec-1 ipoId=ipo-1',
        '- DUPLICATE discoveryRecordId=rec-2',
      ].join('\n'),
    );
  });

  it('invokes ingestLive once and does not call NSE itself', async () => {
    const results: DiscoveryProcessResult[] = [
      {
        outcome: 'CREATED',
        discoveryRecordId: 'rec-1',
        ipoId: 'ipo-1',
      },
    ];
    const ingestLive = jest.fn().mockResolvedValue(results);
    const write = jest.fn();
    const flow = { ingestLive } as unknown as NseDiscoveryFlow;
    const app = {
      get: jest.fn().mockReturnValue(flow),
    };

    await runNseLiveIngest(app, write);

    expect(app.get).toHaveBeenCalledWith(NseDiscoveryFlow);
    expect(ingestLive).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(formatNseLiveIngestSummary(results));
  });
});
