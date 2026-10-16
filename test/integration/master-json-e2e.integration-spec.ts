import * as fs from 'fs';
import * as path from 'path';
import { Prisma, PublicationStatus, MarketSegment, ExchangeListing, DocumentType } from '@prisma/client';
import { AdminIpoService } from '../../src/modules/admin/admin-ipo.service';
import { AdminValidationService } from '../../src/modules/admin/admin-validation.service';
import { AdminProvenanceResolver } from '../../src/modules/admin/admin-provenance.resolver';
import { PrismaService } from '../../src/database/prisma.service';

describe('Master IPO JSON Import End-to-End Real Database Integration', () => {
  let prisma: PrismaService;
  let adminIpoService: AdminIpoService;

  const fixturesDir = 'C:/Users/Anish/Downloads/IPOVault_9_IPOs_With_Live_Subscription_2026-10-15';
  let tonboJson: any;
  let ravitaJson: any;
  let allNineJsons: any[] = [];

  beforeAll(async () => {
    // 1. Initialize real PrismaService against local test database ipovault_test
    prisma = new PrismaService();
    await prisma.$connect();

    const validationService = new AdminValidationService();
    const provenanceResolver = new AdminProvenanceResolver();
    adminIpoService = new AdminIpoService(prisma, validationService, provenanceResolver);

    // 2. Load the 9 actual Master JSON fixtures from disk
    if (fs.existsSync(fixturesDir)) {
      const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
      allNineJsons = files.map((f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8')));
      const tonboFile = files.find((f) => f.includes('tonbo'));
      if (tonboFile) {
        tonboJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, tonboFile), 'utf8'));
      }
      const ravitaFile = files.find((f) => f.includes('ravita'));
      if (ravitaFile) {
        ravitaJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, ravitaFile), 'utf8'));
      }
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    // Clean test database tables before each test to guarantee total isolation
    await prisma.fieldProvenance.deleteMany();
    await prisma.ipoDocument.deleteMany();
    await prisma.ipoParticipant.deleteMany();
    await prisma.ipoOfferCategory.deleteMany();
    await prisma.companyFinancial.deleteMany();
    await prisma.gmpObservation.deleteMany();
    await prisma.ipoLifecycleEvent.deleteMany();
    await prisma.ipoAllotmentConfig.deleteMany();
    await prisma.ipoSourceIdentity.deleteMany();
    await prisma.ipo.deleteMany();
    await prisma.company.deleteMany();
    await prisma.source.deleteMany();
  });

  it('1. verifies preview and commit in Fill-Missing-Only mode: preserves Tonbo 852.18/0 and Ravita 2026-10-19', async () => {
    // Seed Tonbo in DB with inverted issue sizes (freshIssue: 852.18, ofs: 0)
    const tonboComp = await prisma.company.create({
      data: {
        legalName: 'Tonbo Imaging India Private Limited',
        displayName: 'Tonbo Imaging',
      },
    });
    const tonboIpo = await prisma.ipo.create({
      data: {
        companyId: tonboComp.id,
        symbol: 'TONBO',
        issueSize: new Prisma.Decimal('852.18'),
        freshIssueSize: new Prisma.Decimal('852.18'),
        ofsSize: new Prisma.Decimal('0.00'),
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });

    // Seed Ravita in DB with refund date 2026-10-19
    const ravitaComp = await prisma.company.create({
      data: {
        legalName: 'Ravita Engineering Services Limited',
        displayName: 'Ravita Engineering',
      },
    });
    const ravitaIpo = await prisma.ipo.create({
      data: {
        companyId: ravitaComp.id,
        symbol: 'RAVITA',
        marketSegment: MarketSegment.SME,
        exchange: ExchangeListing.BSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });
    await prisma.ipoLifecycleEvent.create({
      data: {
        ipoId: ravitaIpo.id,
        eventType: 'REFUND_INITIATION',
        eventDate: new Date('2026-10-19T00:00:00.000Z'),
      },
    });

    // 1. Run Preview in Default Mode (Fill Missing Only)
    const preview = await adminIpoService.previewAddOnlyJsonImport([tonboJson, ravitaJson], false);
    expect(preview.mode).toBe('FILL_MISSING');
    expect(preview.matchedCount).toBe(2);
    expect(preview.fieldsToOverwriteTotal).toBe(0);

    const tonboPreview = preview.items.find((i) => i.inputSymbol === 'TONBO' || i.inputName.includes('Tonbo'));
    expect(tonboPreview).toBeDefined();
    // In fill mode, freshIssueSize (852.18 vs 0) and ofsSize (0 vs 852.18) are flagged as CONFLICT
    const tonboConflicts = tonboPreview!.fieldsSkipped.filter((s) => s.status === 'CONFLICT');
    expect(tonboConflicts.some((c) => c.field === 'freshIssueSize')).toBe(true);
    expect(tonboConflicts.some((c) => c.field === 'ofsSize')).toBe(true);

    const ravitaPreview = preview.items.find((i) => i.inputSymbol === 'RAVITA' || i.inputName.includes('Ravita'));
    expect(ravitaPreview).toBeDefined();
    const ravitaConflicts = ravitaPreview!.fieldsSkipped.filter((s) => s.status === 'CONFLICT');
    expect(ravitaConflicts.some((c) => c.field === 'timeline.refundInitiationDate' || c.field.includes('REFUND'))).toBe(true);

    // 2. Commit in Fill-Only Mode
    const commitRes = await adminIpoService.commitAddOnlyJsonImport({
      payload: [tonboJson, ravitaJson],
      overwriteExisting: false,
    });
    expect(commitRes.totalRecords).toBe(2);

    // 3. ACTUAL DATABASE READ: Tonbo existing sizes and Ravita refund date MUST NOT BE OVERWRITTEN
    const dbTonbo = await prisma.ipo.findUniqueOrThrow({ where: { id: tonboIpo.id } });
    expect(Number(dbTonbo.freshIssueSize)).toBe(852.18);
    expect(Number(dbTonbo.ofsSize)).toBe(0);

    const dbRavitaEvent = await prisma.ipoLifecycleEvent.findFirstOrThrow({
      where: { ipoId: ravitaIpo.id, eventType: 'REFUND_INITIATION' },
    });
    expect(dbRavitaEvent.eventDate.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('2. verifies Authoritative Overwrite mode: updates Tonbo 852.18->0, ofs 0->852.18, and Ravita date to 2026-10-20', async () => {
    // Seed Tonbo with inverted issue sizes
    const tonboComp = await prisma.company.create({
      data: {
        legalName: 'Tonbo Imaging India Private Limited',
        displayName: 'Tonbo Imaging',
      },
    });
    const tonboIpo = await prisma.ipo.create({
      data: {
        companyId: tonboComp.id,
        symbol: 'TONBO',
        issueSize: new Prisma.Decimal('852.18'),
        freshIssueSize: new Prisma.Decimal('852.18'),
        ofsSize: new Prisma.Decimal('0.00'),
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });

    // Seed Ravita with refund date 2026-10-19
    const ravitaComp = await prisma.company.create({
      data: {
        legalName: 'Ravita Engineering Services Limited',
        displayName: 'Ravita Engineering',
      },
    });
    const ravitaIpo = await prisma.ipo.create({
      data: {
        companyId: ravitaComp.id,
        symbol: 'RAVITA',
        marketSegment: MarketSegment.SME,
        exchange: ExchangeListing.BSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });
    await prisma.ipoLifecycleEvent.create({
      data: {
        ipoId: ravitaIpo.id,
        eventType: 'REFUND_INITIATION',
        eventDate: new Date('2026-10-19T00:00:00.000Z'),
      },
    });

    // 1. Preview in Authoritative Overwrite Mode
    const preview = await adminIpoService.previewAddOnlyJsonImport([tonboJson, ravitaJson], true);
    expect(preview.mode).toBe('AUTHORITATIVE_OVERWRITE');
    expect(preview.fieldsToOverwriteTotal).toBeGreaterThan(0);

    const tonboItem = preview.items.find((i) => i.inputSymbol === 'TONBO' || i.inputName.includes('Tonbo'));
    const freshOverwritten = tonboItem?.fieldsToFill.find((f) => f.field === 'freshIssueSize');
    expect(freshOverwritten).toBeDefined();
    expect(freshOverwritten?.status).toBe('OVERWRITTEN');
    expect(freshOverwritten?.newValue).toBe(0); // 0 preserved!

    const ofsOverwritten = tonboItem?.fieldsToFill.find((f) => f.field === 'ofsSize');
    expect(ofsOverwritten).toBeDefined();
    expect(ofsOverwritten?.status).toBe('OVERWRITTEN');
    expect(ofsOverwritten?.newValue).toBe(852.18);

    // 2. Commit in Authoritative Overwrite Mode
    const commitRes = await adminIpoService.commitAddOnlyJsonImport({
      payload: [tonboJson, ravitaJson],
      overwriteExisting: true,
    });
    expect(commitRes.updatedCount).toBe(2);

    // 3. ACTUAL DATABASE READ: Tonbo sizes updated authoritatively in real PostgreSQL
    const dbTonbo = await prisma.ipo.findUniqueOrThrow({ where: { id: tonboIpo.id } });
    expect(Number(dbTonbo.freshIssueSize)).toBe(0); // 0 updated and preserved!
    expect(Number(dbTonbo.ofsSize)).toBe(852.18);

    // 4. ACTUAL DATABASE READ: Ravita refund date updated to 2026-10-20
    const dbRavitaEvent = await prisma.ipoLifecycleEvent.findFirstOrThrow({
      where: { ipoId: ravitaIpo.id, eventType: 'REFUND_INITIATION' },
    });
    expect(dbRavitaEvent.eventDate.toISOString().slice(0, 10)).toBe('2026-10-20');

    // 5. ACTUAL DATABASE READ: Nested field provenance created in field_provenance table
    const tonboProv = await prisma.fieldProvenance.findMany({
      where: { entityId: tonboIpo.id },
    });
    expect(tonboProv.length).toBeGreaterThan(0);
    expect(tonboProv.some((p) => p.fieldName === 'fresh_issue_size' && p.value === '0')).toBe(true);
    expect(tonboProv.some((p) => p.fieldName === 'ofs_size' && p.value === '852.18')).toBe(true);

    // 6. ACTUAL DATABASE READ: Research sources safely persisted in ipo_documents
    const researchDoc = await prisma.ipoDocument.findFirst({
      where: {
        ipoId: tonboIpo.id,
        documentType: DocumentType.OTHER,
        fileName: 'Research Sources',
      },
    });
    expect(researchDoc).toBeDefined();
    expect(researchDoc?.source).toBe('MASTER_JSON_IMPORT');
    const extraction: any = researchDoc?.extractionData;
    expect(Array.isArray(extraction?.sources)).toBe(true);
    expect(extraction.sources.length).toBeGreaterThan(0);
  });

  it('3. verifies safety: omitted properties and nulls NEVER clear existing values in overwrite mode', async () => {
    // Seed an IPO with established values that might be omitted in a partial JSON
    const comp = await prisma.company.create({
      data: {
        legalName: 'Tonbo Imaging India Private Limited',
        displayName: 'Tonbo Imaging',
        aboutDescription: 'Specialized thermal imaging and sensor systems company',
        website: 'https://tonboimaging.com',
      },
    });
    const ipo = await prisma.ipo.create({
      data: {
        companyId: comp.id,
        symbol: 'TONBO',
        lotSize: 40,
        faceValue: new Prisma.Decimal('2.00'),
        priceBandLow: new Prisma.Decimal('100.00'),
        priceBandHigh: new Prisma.Decimal('110.00'),
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });

    // Craft a payload where aboutDescription is omitted, and priceBandHigh is null
    const partialPayload = {
      company: {
        legalName: 'Tonbo Imaging India Private Limited',
        // aboutDescription omitted
      },
      canonical: {
        lotSize: 50, // Explicit new value
        priceBandHigh: null, // Null should be ignored
      },
    };

    await adminIpoService.commitAddOnlyJsonImport({
      payload: partialPayload,
      overwriteExisting: true,
    });

    // ACTUAL DATABASE READ:
    const dbComp = await prisma.company.findUniqueOrThrow({ where: { id: comp.id } });
    expect(dbComp.aboutDescription).toBe('Specialized thermal imaging and sensor systems company'); // Preserved!
    expect(dbComp.website).toBe('https://tonboimaging.com'); // Preserved!

    const dbIpo = await prisma.ipo.findUniqueOrThrow({ where: { id: ipo.id } });
    expect(dbIpo.lotSize).toBe(50); // Explicit value updated
    expect(Number(dbIpo.priceBandHigh)).toBe(110.00); // Null was ignored, existing preserved!
  });

  it('4. verifies safe handling across all 9 Master JSON fixtures on the real test database', async () => {
    // Seed companies for each of the 9 fixtures so they can match
    for (const data of allNineJsons) {
      const legalName =
        data.company?.legalName ||
        data.company?.displayName ||
        data.ipo?.legalCompanyName ||
        data.ipo?.name;
      const cin = data.identifiers?.cin || data.company?.cin;
      const isin = data.identifiers?.isin || data.ipo?.isin;
      const symbol = data.identifiers?.tradingSymbol || data.identifiers?.symbol || data.ipo?.symbol;

      const comp = await prisma.company.create({
        data: {
          legalName: legalName || `Company-${Math.random()}`,
          displayName: data.company?.displayName || legalName || 'Display Name',
          cin: cin || undefined,
        },
      });

      await prisma.ipo.create({
        data: {
          companyId: comp.id,
          symbol: symbol || undefined,
          isin: isin || undefined,
          marketSegment: MarketSegment.MAINBOARD,
          exchange: ExchangeListing.NSE,
          publicationStatus: PublicationStatus.DRAFT,
        },
      });
    }

    // Run preview for all 9 files
    const preview = await adminIpoService.previewAddOnlyJsonImport(allNineJsons, false);
    expect(preview.totalRecords).toBe(9);
    expect(preview.matchedCount).toBe(9);
    expect(preview.unmatchedCount).toBe(0);
    expect(preview.ambiguousCount).toBe(0);

    // Commit all 9 files in Fill-Only mode
    const commitResult = await adminIpoService.commitAddOnlyJsonImport({
      payload: allNineJsons,
      overwriteExisting: false,
    });
    expect(commitResult.totalRecords).toBe(9);
    expect(commitResult.failedCount).toBe(0);
    expect(commitResult.updatedCount).toBe(9);

    // Verify all 9 IPOs received research sources or financial/anchor documents
    const totalDocs = await prisma.ipoDocument.count();
    expect(totalDocs).toBeGreaterThan(0);
  });

  it('5. confirms stale/mismatched preview data is handled safely when underlying DB record changes before commit', async () => {
    // Seed an IPO with faceValue: null
    const comp = await prisma.company.create({
      data: {
        legalName: 'Tonbo Imaging India Private Limited',
        displayName: 'Tonbo Imaging',
      },
    });
    const ipo = await prisma.ipo.create({
      data: {
        companyId: comp.id,
        symbol: 'TONBO',
        faceValue: null,
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });

    const payload = {
      company: {
        legalName: 'Tonbo Imaging India Private Limited',
      },
      canonical: {
        faceValue: 2,
      },
    };

    // 1. Generate preview when faceValue is null -> preview says fill faceValue: 2
    const preview = await adminIpoService.previewAddOnlyJsonImport(payload, false);
    const fillFaceValue = preview.items[0].fieldsToFill.find((f) => f.field === 'faceValue');
    expect(fillFaceValue).toBeDefined();
    expect(fillFaceValue?.newValue).toBe(2);

    // 2. Concurrently, before commit, another process updates faceValue to 10 in DB!
    await prisma.ipo.update({
      where: { id: ipo.id },
      data: { faceValue: new Prisma.Decimal('10.00') },
    });

    // 3. Commit is called with the original payload in fill-only mode
    const commitRes = await adminIpoService.commitAddOnlyJsonImport({
      payload,
      overwriteExisting: false,
    });

    // Commit re-reads fresh database state, detects conflict with newly populated value 10, and skips it!
    expect(commitRes.skippedCount).toBe(1);

    // 4. ACTUAL DATABASE READ: faceValue remains 10 and was NOT overwritten by stale preview intention!
    const freshDbIpo = await prisma.ipo.findUniqueOrThrow({ where: { id: ipo.id } });
    expect(Number(freshDbIpo.faceValue)).toBe(10.00);
  });

  it('6. confirms preview and commit contract: default mode is FILL_MISSING, overwrite requires explicit flag and counts overwrites', async () => {
    const comp = await prisma.company.create({
      data: {
        legalName: 'Ravita Engineering Services Limited',
        displayName: 'Ravita Engineering',
      },
    });
    const ipo = await prisma.ipo.create({
      data: {
        companyId: comp.id,
        symbol: 'RAVITA',
        lotSize: 100, // existing value
        marketSegment: MarketSegment.SME,
        exchange: ExchangeListing.BSE,
        publicationStatus: PublicationStatus.DRAFT,
      },
    });

    const payload = {
      company: {
        legalName: 'Ravita Engineering Services Limited',
        displayName: 'Ravita Engineering',
      },
      canonical: { lotSize: 200 },
    };

    // Calling preview with undefined/false defaults to FILL_MISSING
    const defaultPreview = await adminIpoService.previewAddOnlyJsonImport(payload);
    expect(defaultPreview.mode).toBe('FILL_MISSING');
    expect(defaultPreview.fieldsToOverwriteTotal).toBe(0);
    expect(defaultPreview.items[0].fieldsSkipped.some((s) => s.field === 'lotSize' && s.status === 'CONFLICT')).toBe(true);

    // Calling preview with overwriteExisting: true returns AUTHORITATIVE_OVERWRITE with overwrite count
    const overwritePreview = await adminIpoService.previewAddOnlyJsonImport(payload, true);
    expect(overwritePreview.mode).toBe('AUTHORITATIVE_OVERWRITE');
    expect(overwritePreview.fieldsToOverwriteTotal).toBe(1);
    const overwriteField = overwritePreview.items[0].fieldsToFill.find((f) => f.field === 'lotSize');
    expect(overwriteField?.status).toBe('OVERWRITTEN');
    expect(overwriteField?.oldValue).toBe(100);
    expect(overwriteField?.newValue).toBe(200);

    // Calling commit with default arguments leaves existing DB value intact
    await adminIpoService.commitAddOnlyJsonImport({ payload });
    const untouchedIpo = await prisma.ipo.findUniqueOrThrow({ where: { id: ipo.id } });
    expect(untouchedIpo.lotSize).toBe(100);

    // Calling commit with overwriteExisting: true updates it
    await adminIpoService.commitAddOnlyJsonImport({ payload, overwriteExisting: true });
    const overwrittenIpo = await prisma.ipo.findUniqueOrThrow({ where: { id: ipo.id } });
    expect(overwrittenIpo.lotSize).toBe(200);
  });
});
