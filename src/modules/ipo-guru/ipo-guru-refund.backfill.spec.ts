import {
  backfillSingleIpoRefundInitiation,
  backfillAllRefundInitiations,
} from './ipo-guru-refund.backfill';

describe('IPOGuru Refund Initiation Date Backfill', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      ipo: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      source: {
        upsert: jest.fn().mockResolvedValue({ id: 'source-ipoguru-id', code: 'IPOGURU' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'source-ipoguru-id', code: 'IPOGURU' }),
      },
      ipoLifecycleEvent: {
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'event-123' }),
      },
      fieldProvenance: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'prov-123' }),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
  });

  const baseIpo = {
    id: 'ipo-test-1',
    companyId: 'company-test-1',
    createdAt: new Date('2026-07-01'),
    company: {
      id: 'company-test-1',
      displayName: 'Laser Power & Infra',
      legalName: 'Laser Power & Infra Limited',
    },
    sourceIdentities: [
      {
        source: { code: 'IPOGURU', name: 'IPO Guru' },
        externalId: 'laser-power-infra-ipo',
      },
    ],
    lifecycleEvents: [
      {
        eventType: 'OPEN',
        eventDate: new Date('2026-07-09'),
        source: { code: 'IPOGURU' },
      },
      {
        eventType: 'CLOSE',
        eventDate: new Date('2026-07-13'),
        source: { code: 'IPOGURU' },
      },
      {
        eventType: 'BASIS_OF_ALLOTMENT',
        eventDate: new Date('2026-07-14'),
        source: { code: 'IPOGURU' },
      },
      {
        eventType: 'LISTING',
        eventDate: new Date('2026-07-16'),
        source: { code: 'IPOGURU' },
      },
    ],
  };

  it('1. Dry-run: classifies ELIGIBLE_TO_CREATE without writing to DB', async () => {
    mockPrisma.ipo.findUnique.mockResolvedValue(baseIpo);

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, baseIpo.id, {
      dryRun: true,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-07-15' } }],
      ]),
    });

    expect(detail.classification).toBe('ELIGIBLE_TO_CREATE');
    expect(detail.action).toBe('CREATE');
    expect(detail.guruRefundDate).toBe('2026-07-15');
    expect(detail.existingDbRefundDate).toBeNull();
    expect(mockPrisma.ipoLifecycleEvent.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
  });

  it('2. Apply mode: creates REFUND_INITIATION event and IPOGURU field provenance', async () => {
    mockPrisma.ipo.findUnique.mockResolvedValue(baseIpo);

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, baseIpo.id, {
      dryRun: false,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-07-15' } }],
      ]),
    });

    expect(detail.classification).toBe('ELIGIBLE_TO_CREATE');
    expect(detail.action).toBe('CREATE');

    expect(mockPrisma.ipoLifecycleEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ipoId_eventType: {
            ipoId: baseIpo.id,
            eventType: 'REFUND_INITIATION',
          },
        },
        create: expect.objectContaining({
          ipoId: baseIpo.id,
          eventType: 'REFUND_INITIATION',
          eventDate: new Date('2026-07-15'),
          sourceId: 'source-ipoguru-id',
        }),
      }),
    );

    expect(mockPrisma.fieldProvenance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'IPO',
          entityId: baseIpo.id,
          fieldName: 'refund_date',
          value: '2026-07-15',
          sourceId: 'source-ipoguru-id',
        }),
      }),
    );
  });

  it('3. Precedence: preserves existing ADMIN/MANUAL provenance untouched', async () => {
    const adminIpo = {
      ...baseIpo,
      id: 'ipo-rk-fashion',
      company: { displayName: 'R.K.Fashion Accessories' },
      lifecycleEvents: [
        ...baseIpo.lifecycleEvents,
        {
          eventType: 'REFUND_INITIATION',
          eventDate: new Date('2026-10-09'),
          source: { code: 'ADMIN' },
        },
      ],
    };

    mockPrisma.ipo.findUnique.mockResolvedValue(adminIpo);
    mockPrisma.fieldProvenance.findMany.mockResolvedValue([
      {
        fieldName: 'refund_date',
        value: '2026-10-09',
        source: { code: 'ADMIN' },
      },
    ]);

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, adminIpo.id, {
      dryRun: false,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-10-08' } }],
      ]),
    });

    expect(detail.classification).toBe('PROTECTED_MANUAL');
    expect(detail.action).toBe('PRESERVE');
    expect(detail.existingDbRefundDate).toBe('2026-10-09');
    expect(mockPrisma.ipoLifecycleEvent.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
  });

  it('4. Existing canonical event: preserves existing REFUND_INITIATION event', async () => {
    const existingIpo = {
      ...baseIpo,
      lifecycleEvents: [
        ...baseIpo.lifecycleEvents,
        {
          eventType: 'REFUND_INITIATION',
          eventDate: new Date('2026-07-15'),
          source: { code: 'IPOGURU' },
        },
      ],
    };

    mockPrisma.ipo.findUnique.mockResolvedValue(existingIpo);

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, existingIpo.id, {
      dryRun: false,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-07-15' } }],
      ]),
    });

    expect(detail.classification).toBe('PRESERVE_EXISTING');
    expect(detail.action).toBe('PRESERVE');
    expect(mockPrisma.ipoLifecycleEvent.upsert).not.toHaveBeenCalled();
  });

  it('5. Conflict: preserves existing date when IPOGuru date differs', async () => {
    const conflictIpo = {
      ...baseIpo,
      lifecycleEvents: [
        ...baseIpo.lifecycleEvents,
        {
          eventType: 'REFUND_INITIATION',
          eventDate: new Date('2026-07-17'),
          source: { code: 'OFFICIAL' },
        },
      ],
    };

    mockPrisma.ipo.findUnique.mockResolvedValue(conflictIpo);

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, conflictIpo.id, {
      dryRun: false,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-07-15' } }],
      ]),
    });

    expect(detail.classification).toBe('CONFLICT_REVIEW');
    expect(detail.action).toBe('PRESERVE');
    expect(mockPrisma.ipoLifecycleEvent.upsert).not.toHaveBeenCalled();
  });

  it('6. Missing IPOGuru date: skips without writing to DB', async () => {
    mockPrisma.ipo.findUnique.mockResolvedValue(baseIpo);

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, baseIpo.id, {
      dryRun: false,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: null } }],
      ]),
    });

    expect(detail.classification).toBe('NO_IPOGURU_DATE');
    expect(detail.action).toBe('SKIP');
    expect(mockPrisma.ipoLifecycleEvent.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
  });

  it('7. Idempotency: applying backfill when provenance already exists does not duplicate provenance', async () => {
    mockPrisma.ipo.findUnique.mockResolvedValue(baseIpo);
    mockPrisma.fieldProvenance.findFirst.mockResolvedValue({ id: 'existing-prov' });

    const detail = await backfillSingleIpoRefundInitiation(mockPrisma, baseIpo.id, {
      dryRun: false,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-07-15' } }],
      ]),
    });

    expect(detail.action).toBe('CREATE');
    expect(mockPrisma.ipoLifecycleEvent.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
  });

  it('8. All IPOs batch processing: aggregates classifications correctly', async () => {
    const ipos = [
      { id: 'ipo-1', company: { displayName: 'IPO 1' } },
      { id: 'ipo-2', company: { displayName: 'IPO 2' } },
    ];

    mockPrisma.ipo.findMany.mockResolvedValue(ipos);
    mockPrisma.ipo.findUnique
      .mockResolvedValueOnce({
        ...baseIpo,
        id: 'ipo-1',
      })
      .mockResolvedValueOnce({
        ...baseIpo,
        id: 'ipo-2',
        lifecycleEvents: [
          ...baseIpo.lifecycleEvents,
          {
            eventType: 'REFUND_INITIATION',
            eventDate: new Date('2026-07-15'),
            source: { code: 'IPOGURU' },
          },
        ],
      });

    const summary = await backfillAllRefundInitiations(mockPrisma, {
      dryRun: true,
      rawGuruMap: new Map([
        ['laser-power-infra-ipo', { timeline: { refund_date: '2026-07-15' } }],
      ]),
    });

    expect(summary.evaluated).toBe(2);
    expect(summary.created).toBe(1);
    expect(summary.preserved).toBe(1);
    expect(summary.protectedManual).toBe(0);
    expect(summary.conflicts).toBe(0);
    expect(summary.errors).toHaveLength(0);
  });
});
