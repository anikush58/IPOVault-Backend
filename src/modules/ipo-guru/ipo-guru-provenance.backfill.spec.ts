import { IpoStatus, MarketSegment, ExchangeListing, SourceType, Prisma } from '@prisma/client';
import { backfillSingleIpoProvenance } from './ipo-guru-provenance.backfill';
import { AdminProvenanceResolver } from '../admin/admin-provenance.resolver';

describe('Field-Level IPOGuru Provenance Backfill', () => {
  let mockPrisma: any;
  let createdProvenances: any[];
  const resolver = new AdminProvenanceResolver();

  const baseIpo = {
    id: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637',
    companyId: 'company-acme',
    marketSegment: MarketSegment.SME,
    exchange: ExchangeListing.BOTH,
    status: IpoStatus.CLOSING_TODAY,
    publicationStatus: 'PUBLISHED',
    symbol: null,
    isin: null,
    priceBandLow: new Prisma.Decimal('186'),
    priceBandHigh: new Prisma.Decimal('196'),
    lotSize: 600,
    faceValue: new Prisma.Decimal('10'),
    issueSize: new Prisma.Decimal('121.69'),
    freshIssueSize: new Prisma.Decimal('105.98'),
    ofsSize: new Prisma.Decimal('15.71'),
    listingPrice: null,
    createdAt: new Date('2026-09-25T09:30:00Z'),
    updatedAt: new Date('2026-10-05T18:30:00Z'),
    company: {
      id: 'company-acme',
      legalName: 'Acme India Industries',
      displayName: 'Acme India Industries',
      cin: 'U93090DL2021PLC391603',
    },
    sourceIdentities: [
      {
        sourceId: 'src-guru',
        externalId: 'acme-india-industries-sme-ipo',
        source: { id: 'src-guru', code: 'IPOGURU', name: 'IPO Guru v2', sourceType: SourceType.SECONDARY },
      },
      {
        sourceId: 'src-admin',
        externalId: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637',
        source: { id: 'src-admin', code: 'ADMIN', name: 'Admin Manual Review', sourceType: SourceType.OFFICIAL_FILING },
      },
    ],
    lifecycleEvents: [
      {
        eventType: 'OPEN',
        eventDate: new Date('2026-09-30'),
        sourceId: 'src-guru',
        source: { id: 'src-guru', code: 'IPOGURU' },
      },
      {
        eventType: 'CLOSE',
        eventDate: new Date('2026-10-06'),
        sourceId: 'src-guru',
        source: { id: 'src-guru', code: 'IPOGURU' },
      },
      {
        eventType: 'BASIS_OF_ALLOTMENT',
        eventDate: new Date('2026-10-07'),
        sourceId: 'src-guru',
        source: { id: 'src-guru', code: 'IPOGURU' },
      },
      {
        eventType: 'LISTING',
        eventDate: new Date('2026-10-09'),
        sourceId: 'src-guru',
        source: { id: 'src-guru', code: 'IPOGURU' },
      },
    ],
    allotmentConfig: {
      registrar: 'BIGSHARE',
    },
  };

  const adminProvenances = [
    {
      id: 'p1',
      entityType: 'COMPANY',
      entityId: 'company-acme',
      fieldName: 'company.legal_name',
      value: 'Acme India Industries',
      sourceId: 'src-admin',
      sourceReference: 'ADMIN_UPDATE',
      retrievedAt: new Date('2026-10-02T08:44:21Z'),
      source: { id: 'src-admin', code: 'ADMIN', name: 'Admin Manual Review', sourceType: SourceType.OFFICIAL_FILING },
    },
    {
      id: 'p2',
      entityType: 'IPO',
      entityId: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637',
      fieldName: 'price_band_low',
      value: '186',
      sourceId: 'src-admin',
      sourceReference: 'ADMIN_UPDATE',
      retrievedAt: new Date('2026-10-02T08:44:21Z'),
      source: { id: 'src-admin', code: 'ADMIN', name: 'Admin Manual Review', sourceType: SourceType.OFFICIAL_FILING },
    },
    {
      id: 'p3',
      entityType: 'IPO',
      entityId: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637',
      fieldName: 'price_band_high',
      value: '196',
      sourceId: 'src-admin',
      sourceReference: 'ADMIN_UPDATE',
      retrievedAt: new Date('2026-10-02T08:44:21Z'),
      source: { id: 'src-admin', code: 'ADMIN', name: 'Admin Manual Review', sourceType: SourceType.OFFICIAL_FILING },
    },
    {
      id: 'p4',
      entityType: 'IPO',
      entityId: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637',
      fieldName: 'issue_size',
      value: '121.69',
      sourceId: 'src-admin',
      sourceReference: 'ADMIN_UPDATE',
      retrievedAt: new Date('2026-10-02T08:44:21Z'),
      source: { id: 'src-admin', code: 'ADMIN', name: 'Admin Manual Review', sourceType: SourceType.OFFICIAL_FILING },
    },
  ];

  beforeEach(() => {
    createdProvenances = [...adminProvenances];

    mockPrisma = {
      ipo: {
        findUnique: jest.fn().mockResolvedValue(baseIpo),
      },
      source: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.code === 'IPOGURU') {
            return Promise.resolve({
              id: 'src-guru',
              code: 'IPOGURU',
              name: 'IPO Guru v2',
              sourceType: SourceType.SECONDARY,
            });
          }
          return Promise.resolve(null);
        }),
      },
      fieldProvenance: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(createdProvenances)),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const newRow = {
            id: `p-${createdProvenances.length + 1}`,
            ...data,
            source: {
              id: data.sourceId,
              code: data.sourceId === 'src-admin' ? 'ADMIN' : (data.sourceId === 'src-nse' ? 'NSE' : 'IPOGURU'),
              name: data.sourceId === 'src-admin' ? 'Admin Manual Review' : 'IPO Guru v2',
              sourceType: data.sourceId === 'src-admin' ? SourceType.OFFICIAL_FILING : SourceType.SECONDARY,
            },
          };
          createdProvenances.push(newRow);
          return Promise.resolve(newRow);
        }),
      },
    };
  });

  it('1. Dry-run plans correct PRESERVE, ADD, and SKIP actions without writing to DB', async () => {
    const summary = await backfillSingleIpoProvenance(mockPrisma, baseIpo.id, { dryRun: true });

    expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
    expect(summary.preserved).toBe(4);
    expect(summary.skipped).toBeGreaterThanOrEqual(4); // cin, publication_status, symbol, isin, listing_price, status (CLOSING_TODAY)
    expect(summary.added).toBeGreaterThanOrEqual(10); // display_name, market_segment, exchange, lot_size, face_value, dates, registrar, etc.

    const preservedLegalName = summary.details.find((d) => d.fieldKey === 'company.legal_name');
    expect(preservedLegalName?.action).toBe('PRESERVE');

    const skippedCin = summary.details.find((d) => d.fieldKey === 'company.cin');
    expect(skippedCin?.action).toBe('SKIP');
    expect(skippedCin?.reason).toContain('not provided/supported by IPOGuru');
  });

  it('2. Mixed Provenance: Preserves existing ADMIN fields and adds IPOGURU fields', async () => {
    const summary = await backfillSingleIpoProvenance(mockPrisma, baseIpo.id, { dryRun: false });

    expect(summary.preserved).toBe(4);
    expect(mockPrisma.fieldProvenance.create).toHaveBeenCalled();

    // Verify through resolver
    const resolved = resolver.resolveAllFields(
      {
        legalName: baseIpo.company.legalName,
        displayName: baseIpo.company.displayName,
        cin: baseIpo.company.cin,
        marketSegment: baseIpo.marketSegment,
        exchange: baseIpo.exchange,
        status: baseIpo.status,
        priceBandLow: 186,
        priceBandHigh: 196,
        lotSize: 600,
        issueSize: 121.69,
        freshIssueSize: 105.98,
        ofsSize: 15.71,
        openDate: '2026-09-30',
        closeDate: '2026-10-06',
        allotmentDate: '2026-10-07',
        listingDate: '2026-10-09',
        registrarName: 'BIGSHARE',
      },
      createdProvenances,
    );

    // ADMIN fields MUST remain Manual
    expect(resolved.legalName.status).toBe('MANUAL');
    expect(resolved.priceBandLow.status).toBe('MANUAL');
    expect(resolved.priceBandHigh.status).toBe('MANUAL');
    expect(resolved.issueSize.status).toBe('MANUAL');

    // Added fields MUST be IPOGURU
    expect(resolved.displayName.status).toBe('IPOGURU');
    expect(resolved.marketSegment.status).toBe('IPOGURU');
    expect(resolved.exchange.status).toBe('IPOGURU');
    expect(resolved.lotSize.status).toBe('IPOGURU');
    expect(resolved.freshIssueSize.status).toBe('IPOGURU');
    expect(resolved.ofsSize.status).toBe('IPOGURU');
    expect(resolved.openDate.status).toBe('IPOGURU');
    expect(resolved.closeDate.status).toBe('IPOGURU');
    expect(resolved.allotmentDate.status).toBe('IPOGURU');
    expect(resolved.listingDate.status).toBe('IPOGURU');
    expect(resolved.registrarName.status).toBe('IPOGURU');

    // CIN must remain NO_VERIFIED_DATA (not falsely labeled)
    expect(resolved.cin.status).toBe('NO_VERIFIED_DATA');
  });

  it('3. Idempotency: Running backfill twice creates ZERO duplicate records', async () => {
    // First run
    const firstRun = await backfillSingleIpoProvenance(mockPrisma, baseIpo.id, { dryRun: false });
    const countAfterFirst = createdProvenances.length;
    expect(firstRun.added).toBeGreaterThan(0);

    // Second run
    const secondRun = await backfillSingleIpoProvenance(mockPrisma, baseIpo.id, { dryRun: false });
    expect(secondRun.added).toBe(0);
    expect(secondRun.preserved).toBe(firstRun.preserved + firstRun.added);
    expect(createdProvenances.length).toBe(countAfterFirst);
  });

  it('4. Preserves OFFICIAL exchange provenance without overwriting', async () => {
    // Add official NSE provenance for exchange and lot_size
    const officialProvs = [
      ...adminProvenances,
      {
        id: 'p-nse-1',
        entityType: 'IPO',
        entityId: baseIpo.id,
        fieldName: 'exchange',
        value: 'NSE',
        sourceId: 'src-nse',
        sourceReference: 'https://nseindia.com',
        retrievedAt: new Date('2026-10-01T10:00:00Z'),
        source: { id: 'src-nse', code: 'NSE', name: 'National Stock Exchange', sourceType: SourceType.EXCHANGE },
      },
    ];
    createdProvenances = [...officialProvs];

    const summary = await backfillSingleIpoProvenance(mockPrisma, baseIpo.id, { dryRun: false });

    // Official field was preserved
    const exchangePlan = summary.details.find((d) => d.fieldKey === 'exchange');
    expect(exchangePlan?.action).toBe('PRESERVE');
    expect(exchangePlan?.existingProvenance).toContain('NSE');

    const resolved = resolver.resolveAllFields({ exchange: 'NSE' }, createdProvenances);
    expect(resolved.exchange.status).toBe('OFFICIAL_SOURCE');
  });

  it('5. Non-IPOGuru fields (CIN, publicationStatus, financials) are not falsely classified', async () => {
    const summary = await backfillSingleIpoProvenance(mockPrisma, baseIpo.id, { dryRun: false });

    const cinPlan = summary.details.find((d) => d.fieldKey === 'company.cin');
    expect(cinPlan?.action).toBe('SKIP');

    const pubStatusPlan = summary.details.find((d) => d.fieldKey === 'publication_status');
    expect(pubStatusPlan?.action).toBe('SKIP');

    const resolved = resolver.resolveAllFields(
      {
        cin: baseIpo.company.cin,
        publicationStatus: 'PUBLISHED',
      },
      createdProvenances,
    );

    expect(resolved.cin.status).toBe('NO_VERIFIED_DATA');
    expect(resolved.publicationStatus.status).toBe('NO_VERIFIED_DATA');
  });
});
