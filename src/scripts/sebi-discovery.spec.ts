import { SebiDiscoveryFlow, SebiIngestionResult } from '../modules/discovery/adapters/sebi/sebi-discovery.flow';
import { formatSebiLiveIngestSummary, runSebiLiveIngest } from './sebi-discovery';

describe('SEBI production discovery runner & orchestration (Phase 4)', () => {
  it('A & J. formats concise operational summary correctly', () => {
    const sampleResult: SebiIngestionResult = {
      totalDiscovered: 5,
      duplicateCount: 2,
      createdRecordsCount: 3,
      downloadedDocumentsCount: 2,
      skippedDocumentsCount: 1,
      failedDownloadsCount: 0,
      canonicalCreatedCount: 1,
      canonicalMatchedCount: 1,
    };

    const formatted = formatSebiLiveIngestSummary(sampleResult);
    expect(formatted).toContain('SEBI discovery ingest summary:');
    expect(formatted).toContain('- Discovered filing observations: 5');
    expect(formatted).toContain('- Listing duplicates skipped: 2');
    expect(formatted).toContain('- New listing records created: 3');
    expect(formatted).toContain('- PDF documents downloaded: 2');
    expect(formatted).toContain('- PDF documents skipped (already processed): 1');
    expect(formatted).toContain('- PDF document failures: 0');
    expect(formatted).toContain('- Canonical IPOs created: 1');
    expect(formatted).toContain('- Canonical IPOs matched: 1');
  });

  it('B & K. CLI resolves SebiDiscoveryFlow, executes run, and reports output', async () => {
    const sampleResult: SebiIngestionResult = {
      totalDiscovered: 2,
      duplicateCount: 0,
      createdRecordsCount: 2,
      downloadedDocumentsCount: 1,
      skippedDocumentsCount: 1,
      failedDownloadsCount: 0,
      canonicalCreatedCount: 1,
      canonicalMatchedCount: 0,
    };

    const mockRun = jest.fn().mockResolvedValue(sampleResult);
    const mockFlow = { run: mockRun } as unknown as SebiDiscoveryFlow;
    const mockApp = { get: jest.fn().mockReturnValue(mockFlow) };
    const mockWrite = jest.fn();

    const result = await runSebiLiveIngest(mockApp, 1, true, mockWrite);

    expect(mockApp.get).toHaveBeenCalledWith(SebiDiscoveryFlow);
    expect(mockRun).toHaveBeenCalledWith(1, undefined, true, true);
    expect(mockWrite).toHaveBeenCalledWith(formatSebiLiveIngestSummary(sampleResult));
    expect(result).toEqual(sampleResult);
  });
});
