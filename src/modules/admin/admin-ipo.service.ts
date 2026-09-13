import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentType,
  ExchangeListing,
  MarketSegment,
  Prisma,
  PublicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { deriveIpoStatus } from '../discovery/canonicalizer.service';
import { AdminExtractionService } from './admin-extraction.service';
import {
  AdminIpoQueryDto,
  ConfigureAllotmentDto,
  CreateAdminIpoDto,
  UpdateAdminIpoDto,
} from './admin-ipo.dto';
import { AdminValidationService } from './admin-validation.service';

@Injectable()
export class AdminIpoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: AdminValidationService,
    private readonly extractionService: AdminExtractionService,
  ) {}

  /**
   * Helper to ensure an 'ADMIN' source record exists for provenance recording.
   */
  private async getAdminSourceId(): Promise<string> {
    const source = await this.prisma.source.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: {
        code: 'ADMIN',
        name: 'Admin Manual Review',
        sourceType: 'OFFICIAL_FILING',
        priority: 1,
      },
    });
    return source.id;
  }

  /**
   * Links an IPO to the 'ADMIN' SourceIdentity to mark it as admin-managed.
   */
  private async ensureAdminSourceIdentity(
    ipoId: string,
    symbol?: string | null,
  ): Promise<void> {
    const adminSourceId = await this.getAdminSourceId();
    await this.prisma.ipoSourceIdentity.upsert({
      where: {
        ipoId_sourceId: {
          ipoId,
          sourceId: adminSourceId,
        },
      },
      update: {
        ...(symbol !== undefined ? { symbol: symbol?.trim() || null } : {}),
      },
      create: {
        ipoId,
        sourceId: adminSourceId,
        externalId: ipoId,
        symbol: symbol?.trim() || null,
      },
    });
  }

  /**
   * Creates a new DRAFT IPO with associated Company.
   */
  async createIpo(dto: CreateAdminIpoDto) {
    const adminSourceId = await this.getAdminSourceId();
    const legalName = dto.legalName.trim();
    const displayName = dto.displayName?.trim() || legalName;

    // Check if Company already exists by CIN or Legal Name
    let company = await this.prisma.company.findFirst({
      where: {
        OR: [
          ...(dto.cin ? [{ cin: dto.cin.trim() }] : []),
          { legalName: { equals: legalName, mode: 'insensitive' } },
        ],
      },
    });

    if (!company) {
      company = await this.prisma.company.create({
        data: {
          legalName,
          displayName,
          cin: dto.cin?.trim() || null,
        },
      });
    }

    // Derive canonical lifecycle status from open/close dates if status is absent or DRAFT
    const derivedStatus = deriveIpoStatus({
      explicitStatus: dto.status,
      openDate: dto.openDate,
      closeDate: dto.closeDate,
    });

    const ipo = await this.prisma.ipo.create({
      data: {
        companyId: company.id,
        marketSegment: dto.marketSegment || MarketSegment.MAINBOARD,
        exchange: dto.exchange || ExchangeListing.NSE,
        status: derivedStatus,
        publicationStatus: dto.publicationStatus || PublicationStatus.DRAFT,
        symbol: dto.symbol?.trim() || null,
        priceBandLow:
          dto.priceBandLow !== undefined
            ? new Prisma.Decimal(dto.priceBandLow)
            : null,
        priceBandHigh:
          dto.priceBandHigh !== undefined
            ? new Prisma.Decimal(dto.priceBandHigh)
            : null,
        lotSize: dto.lotSize || null,
        issueSize:
          dto.issueSize !== undefined
            ? new Prisma.Decimal(dto.issueSize)
            : null,
        freshIssueSize:
          dto.freshIssueSize !== undefined
            ? new Prisma.Decimal(dto.freshIssueSize)
            : null,
        ofsSize:
          dto.ofsSize !== undefined
            ? new Prisma.Decimal(dto.ofsSize)
            : null,
        issueShareCount:
          dto.issueShareCount !== undefined
            ? new Prisma.Decimal(dto.issueShareCount)
            : null,
        freshIssueShareCount:
          dto.freshIssueShareCount !== undefined
            ? new Prisma.Decimal(dto.freshIssueShareCount)
            : null,
        ofsShareCount:
          dto.ofsShareCount !== undefined
            ? new Prisma.Decimal(dto.ofsShareCount)
            : null,
        faceValue:
          dto.faceValue !== undefined
            ? new Prisma.Decimal(dto.faceValue)
            : null,
      },
      include: { company: true },
    });

    // Create lifecycle events if dates provided
    await this.updateLifecycleEvents(ipo.id, {
      openDate: dto.openDate,
      closeDate: dto.closeDate,
      listingDate: dto.listingDate,
    });

    // Save field provenance for created fields
    await this.recordFieldProvenance(
      ipo.id,
      company.id,
      dto,
      adminSourceId,
      'ADMIN_CREATE',
    );

    // Link ADMIN source identity to mark as admin-managed
    await this.ensureAdminSourceIdentity(ipo.id, ipo.symbol);

    return this.getIpoDetail(ipo.id);
  }

  /**
   * Updates an existing IPO and its Company details.
   */
  async updateIpo(id: string, dto: UpdateAdminIpoDto) {
    const adminSourceId = await this.getAdminSourceId();
    const existing = await this.prisma.ipo.findUnique({
      where: { id },
      include: { company: true, lifecycleEvents: true },
    });

    if (!existing) {
      throw new NotFoundException(`IPO with ID '${id}' not found`);
    }

    // Update company if legalName or cin changed
    if (dto.legalName || dto.displayName || dto.cin) {
      await this.prisma.company.update({
        where: { id: existing.companyId },
        data: {
          ...(dto.legalName ? { legalName: dto.legalName.trim() } : {}),
          ...(dto.displayName ? { displayName: dto.displayName.trim() } : {}),
          ...(dto.cin !== undefined ? { cin: dto.cin?.trim() || null } : {}),
        },
      });
    }

    // Derive status if openDate/closeDate provided or status explicitly updated
    const openEvent = existing.lifecycleEvents.find(
      (e) => e.eventType === 'OPEN',
    );
    const closeEvent = existing.lifecycleEvents.find(
      (e) => e.eventType === 'CLOSE',
    );

    const openDate = dto.openDate !== undefined ? dto.openDate : openEvent?.eventDate.toISOString();
    const closeDate = dto.closeDate !== undefined ? dto.closeDate : closeEvent?.eventDate.toISOString();

    const derivedStatus = deriveIpoStatus({
      explicitStatus: dto.status,
      currentStatus: existing.status,
      openDate,
      closeDate,
    });

    await this.prisma.ipo.update({
      where: { id },
      data: {
        ...(dto.marketSegment ? { marketSegment: dto.marketSegment } : {}),
        ...(dto.exchange ? { exchange: dto.exchange } : {}),
        status: derivedStatus,
        ...(dto.publicationStatus
          ? { publicationStatus: dto.publicationStatus }
          : {}),
        ...(dto.symbol !== undefined ? { symbol: dto.symbol?.trim() || null } : {}),
        ...(dto.priceBandLow !== undefined
          ? {
              priceBandLow:
                dto.priceBandLow !== null
                  ? new Prisma.Decimal(dto.priceBandLow)
                  : null,
            }
          : {}),
        ...(dto.priceBandHigh !== undefined
          ? {
              priceBandHigh:
                dto.priceBandHigh !== null
                  ? new Prisma.Decimal(dto.priceBandHigh)
                  : null,
            }
          : {}),
        ...(dto.lotSize !== undefined ? { lotSize: dto.lotSize } : {}),
        ...(dto.issueSize !== undefined
          ? {
              issueSize:
                dto.issueSize !== null
                  ? new Prisma.Decimal(dto.issueSize)
                  : null,
            }
          : {}),
        ...(dto.freshIssueSize !== undefined
          ? {
              freshIssueSize:
                dto.freshIssueSize !== null
                  ? new Prisma.Decimal(dto.freshIssueSize)
                  : null,
            }
          : {}),
        ...(dto.ofsSize !== undefined
          ? {
              ofsSize:
                dto.ofsSize !== null
                  ? new Prisma.Decimal(dto.ofsSize)
                  : null,
            }
          : {}),
        ...(dto.issueShareCount !== undefined
          ? {
              issueShareCount:
                dto.issueShareCount !== null
                  ? new Prisma.Decimal(dto.issueShareCount)
                  : null,
            }
          : {}),
        ...(dto.freshIssueShareCount !== undefined
          ? {
              freshIssueShareCount:
                dto.freshIssueShareCount !== null
                  ? new Prisma.Decimal(dto.freshIssueShareCount)
                  : null,
            }
          : {}),
        ...(dto.ofsShareCount !== undefined
          ? {
              ofsShareCount:
                dto.ofsShareCount !== null
                  ? new Prisma.Decimal(dto.ofsShareCount)
                  : null,
            }
          : {}),
        ...(dto.faceValue !== undefined
          ? {
              faceValue:
                dto.faceValue !== null
                  ? new Prisma.Decimal(dto.faceValue)
                  : null,
            }
          : {}),
      },
    });

    if (
      dto.openDate !== undefined ||
      dto.closeDate !== undefined ||
      dto.listingDate !== undefined
    ) {
      await this.updateLifecycleEvents(id, {
        openDate: dto.openDate,
        closeDate: dto.closeDate,
        listingDate: dto.listingDate,
      });
    }

    await this.recordFieldProvenance(
      id,
      existing.companyId,
      dto,
      adminSourceId,
      'ADMIN_UPDATE',
    );

    await this.ensureAdminSourceIdentity(id, dto.symbol);

    return this.getIpoDetail(id);
  }

  /**
   * Full admin detail view (incorporates canonical data, publication state, documents, validation, allotment config).
   */
  async getIpoDetail(id: string) {
    const ipo = await this.prisma.ipo.findUnique({
      where: { id },
      include: {
        company: true,
        lifecycleEvents: true,
        documents: true,
        allotmentConfig: true,
        sourceIdentities: { include: { source: true } },
      },
    });

    if (!ipo) {
      throw new NotFoundException(`IPO with ID '${id}' not found`);
    }

    const openEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'OPEN');
    const closeEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'CLOSE');
    const listingEvent = ipo.lifecycleEvents.find(
      (e) => e.eventType === 'LISTING',
    );

    const validationReport = this.validationService.validateIpo({
      legalName: ipo.company.legalName,
      displayName: ipo.company.displayName,
      cin: ipo.company.cin,
      symbol: ipo.symbol,
      marketSegment: ipo.marketSegment,
      status: ipo.status,
      publicationStatus: ipo.publicationStatus,
      priceBandLow: ipo.priceBandLow ? Number(ipo.priceBandLow) : null,
      priceBandHigh: ipo.priceBandHigh ? Number(ipo.priceBandHigh) : null,
      lotSize: ipo.lotSize,
      issueSize: ipo.issueSize ? Number(ipo.issueSize) : null,
      freshIssueSize: ipo.freshIssueSize ? Number(ipo.freshIssueSize) : null,
      ofsSize: ipo.ofsSize ? Number(ipo.ofsSize) : null,
      issueShareCount: ipo.issueShareCount ? Number(ipo.issueShareCount) : null,
      freshIssueShareCount: ipo.freshIssueShareCount
        ? Number(ipo.freshIssueShareCount)
        : null,
      ofsShareCount: ipo.ofsShareCount ? Number(ipo.ofsShareCount) : null,
      openDate: openEvent ? openEvent.eventDate.toISOString() : null,
      closeDate: closeEvent ? closeEvent.eventDate.toISOString() : null,
      listingDate: listingEvent ? listingEvent.eventDate.toISOString() : null,
    });

    return {
      id: ipo.id,
      companyId: ipo.companyId,
      company: {
        legalName: ipo.company.legalName,
        displayName: ipo.company.displayName,
        cin: ipo.company.cin,
        website: ipo.company.website,
        industry: ipo.company.industry,
        sector: ipo.company.sector,
      },
      marketSegment: ipo.marketSegment,
      exchange: ipo.exchange,
      status: ipo.status,
      publicationStatus: ipo.publicationStatus,
      symbol: ipo.symbol,
      issueSize: ipo.issueSize ? Number(ipo.issueSize) : null,
      freshIssueSize: ipo.freshIssueSize ? Number(ipo.freshIssueSize) : null,
      ofsSize: ipo.ofsSize ? Number(ipo.ofsSize) : null,
      issueShareCount: ipo.issueShareCount ? Number(ipo.issueShareCount) : null,
      freshIssueShareCount: ipo.freshIssueShareCount
        ? Number(ipo.freshIssueShareCount)
        : null,
      ofsShareCount: ipo.ofsShareCount ? Number(ipo.ofsShareCount) : null,
      faceValue: ipo.faceValue ? Number(ipo.faceValue) : null,
      priceBandLow: ipo.priceBandLow ? Number(ipo.priceBandLow) : null,
      priceBandHigh: ipo.priceBandHigh ? Number(ipo.priceBandHigh) : null,
      lotSize: ipo.lotSize,
      openDate: openEvent ? openEvent.eventDate.toISOString().slice(0, 10) : null,
      closeDate: closeEvent ? closeEvent.eventDate.toISOString().slice(0, 10) : null,
      listingDate: listingEvent
        ? listingEvent.eventDate.toISOString().slice(0, 10)
        : null,
      documents: ipo.documents,
      allotmentConfig: ipo.allotmentConfig,
      sourceIdentities: ipo.sourceIdentities,
      validation: validationReport,
      createdAt: ipo.createdAt,
      updatedAt: ipo.updatedAt,
    };
  }

  /**
   * Searchable Admin list query returning all IPOs (DRAFT, PUBLISHED, ARCHIVED).
   */
  async listIpos(query: AdminIpoQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.IpoWhereInput = {
      sourceIdentities: {
        some: {
          source: {
            code: 'ADMIN',
          },
        },
      },
    };

    const trimmedQ = query.q?.trim();
    if (trimmedQ) {
      where.AND = [
        {
          OR: [
            { company: { legalName: { contains: trimmedQ, mode: 'insensitive' } } },
            { company: { displayName: { contains: trimmedQ, mode: 'insensitive' } } },
            { company: { cin: { contains: trimmedQ, mode: 'insensitive' } } },
            { symbol: { contains: trimmedQ, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (query.status) where.status = query.status;
    if (query.publicationStatus) where.publicationStatus = query.publicationStatus;
    if (query.marketSegment) where.marketSegment = query.marketSegment;
    if (query.exchange) where.exchange = query.exchange;

    const [items, total] = await Promise.all([
      this.prisma.ipo.findMany({
        where,
        include: { company: true, lifecycleEvents: true, allotmentConfig: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.ipo.count({ where }),
    ]);

    return {
      items: items.map((ipo) => {
        const openEv = ipo.lifecycleEvents.find((e) => e.eventType === 'OPEN');
        const closeEv = ipo.lifecycleEvents.find((e) => e.eventType === 'CLOSE');
        return {
          id: ipo.id,
          legalName: ipo.company.legalName,
          displayName: ipo.company.displayName,
          symbol: ipo.symbol,
          marketSegment: ipo.marketSegment,
          exchange: ipo.exchange,
          status: ipo.status,
          publicationStatus: ipo.publicationStatus,
          priceBandLow: ipo.priceBandLow ? Number(ipo.priceBandLow) : null,
          priceBandHigh: ipo.priceBandHigh ? Number(ipo.priceBandHigh) : null,
          openDate: openEv ? openEv.eventDate.toISOString().slice(0, 10) : null,
          closeDate: closeEv ? closeEv.eventDate.toISOString().slice(0, 10) : null,
          hasAllotmentConfig: !!ipo.allotmentConfig,
          updatedAt: ipo.updatedAt,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Validates and publishes an IPO.
   */
  async publishIpo(id: string) {
    const detail = await this.getIpoDetail(id);

    if (!detail.validation.isValid) {
      throw new BadRequestException({
        message: 'Cannot publish IPO due to validation errors.',
        errors: detail.validation.errors,
      });
    }

    const updated = await this.prisma.ipo.update({
      where: { id },
      data: { publicationStatus: PublicationStatus.PUBLISHED },
    });

    await this.ensureAdminSourceIdentity(id, updated.symbol);

    return {
      id: updated.id,
      publicationStatus: updated.publicationStatus,
      message: 'IPO published successfully.',
    };
  }

  /**
   * Sets publication status to DRAFT.
   */
  async unpublishIpo(id: string) {
    const updated = await this.prisma.ipo.update({
      where: { id },
      data: { publicationStatus: PublicationStatus.DRAFT },
    });

    await this.ensureAdminSourceIdentity(id, updated.symbol);

    return {
      id: updated.id,
      publicationStatus: updated.publicationStatus,
      message: 'IPO unpublished (reverted to DRAFT).',
    };
  }

  /**
   * Sets publication status to ARCHIVED.
   */
  async archiveIpo(id: string) {
    const updated = await this.prisma.ipo.update({
      where: { id },
      data: { publicationStatus: PublicationStatus.ARCHIVED },
    });

    await this.ensureAdminSourceIdentity(id, updated.symbol);

    return {
      id: updated.id,
      publicationStatus: updated.publicationStatus,
      message: 'IPO archived.',
    };
  }

  /**
   * Parses a PDF buffer and creates/attaches an IpoDocument record.
   */
  async parseAndStorePdfBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    ipoId?: string,
    documentType: DocumentType = DocumentType.RHP,
  ) {
    let review;
    let parsingStatus: 'PARSED' | 'FAILED' = 'PARSED';
    let errorMessage: string | null = null;

    try {
      review = await this.extractionService.extractFromPdfBuffer(buffer);
    } catch (err: any) {
      parsingStatus = 'FAILED';
      errorMessage = err.message || 'PDF parsing failed';
    }

    const doc = await this.prisma.ipoDocument.create({
      data: {
        ipoId: ipoId || null,
        documentType,
        fileName,
        mimeType,
        fileSizeBytes: buffer.length,
        source: 'MANUAL_UPLOAD',
        parsingStatus,
        parserVersion: review?.parserVersion || 'sebi-pdf-parser-1.0.0',
        extractionData: review ? (review as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        errorMessage,
      },
    });

    return {
      documentId: doc.id,
      parsingStatus: doc.parsingStatus,
      extraction: review || null,
      errorMessage: doc.errorMessage,
    };
  }

  /**
   * Fetches URL (resolving SEBI HTML iframe if needed) and parses PDF.
   */
  async parseUrlAndStore(
    url: string,
    ipoId?: string,
    documentType: DocumentType = DocumentType.RHP,
  ) {
    let review;
    let targetPdfUrl = url;
    let parsingStatus: 'PARSED' | 'FAILED' = 'PARSED';
    let errorMessage: string | null = null;

    try {
      const result = await this.extractionService.extractFromUrl(
        url,
        async (targetUrl) => {
          const res = await fetch(targetUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText} fetching URL: ${targetUrl}`);
          }
          const arrayBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          const contentType = res.headers.get('content-type') || '';
          return { content: buf, contentType };
        },
      );
      review = result.review;
      targetPdfUrl = result.pdfUrl;
    } catch (err: any) {
      parsingStatus = 'FAILED';
      errorMessage = err.message || 'URL ingestion/parsing failed';
    }

    const doc = await this.prisma.ipoDocument.create({
      data: {
        ipoId: ipoId || null,
        documentType,
        sourceUrl: targetPdfUrl,
        source: 'URL_INGESTION',
        parsingStatus,
        parserVersion: review?.parserVersion || 'sebi-pdf-parser-1.0.0',
        extractionData: review ? (review as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        errorMessage,
      },
    });

    return {
      documentId: doc.id,
      sourceUrl: targetPdfUrl,
      parsingStatus: doc.parsingStatus,
      extraction: review || null,
      errorMessage: doc.errorMessage,
    };
  }

  /**
   * Configures or updates registrar allotment checking settings for a published IPO.
   */
  async configureAllotment(ipoId: string, dto: ConfigureAllotmentDto) {
    const ipo = await this.prisma.ipo.findUnique({ where: { id: ipoId } });
    if (!ipo) {
      throw new NotFoundException(`IPO with ID '${ipoId}' not found`);
    }

    const expectedDate = dto.expectedAllotmentDate
      ? new Date(dto.expectedAllotmentDate)
      : null;

    const config = await this.prisma.ipoAllotmentConfig.upsert({
      where: { ipoId },
      update: {
        registrar: dto.registrar.toLowerCase().trim(),
        registrarIpoCode: dto.registrarIpoCode?.trim() || null,
        allotmentSourceUrl: dto.allotmentSourceUrl?.trim() || null,
        expectedAllotmentDate: expectedDate,
        enabled: dto.enabled !== undefined ? dto.enabled : true,
      },
      create: {
        ipoId,
        registrar: dto.registrar.toLowerCase().trim(),
        registrarIpoCode: dto.registrarIpoCode?.trim() || null,
        allotmentSourceUrl: dto.allotmentSourceUrl?.trim() || null,
        expectedAllotmentDate: expectedDate,
        enabled: dto.enabled !== undefined ? dto.enabled : true,
      },
    });

    return config;
  }

  private async updateLifecycleEvents(
    ipoId: string,
    dates: { openDate?: string; closeDate?: string; listingDate?: string },
  ) {
    const updates: Array<{ eventType: 'OPEN' | 'CLOSE' | 'LISTING'; dateStr?: string }> = [
      { eventType: 'OPEN', dateStr: dates.openDate },
      { eventType: 'CLOSE', dateStr: dates.closeDate },
      { eventType: 'LISTING', dateStr: dates.listingDate },
    ];

    for (const item of updates) {
      if (item.dateStr === undefined) continue;

      if (item.dateStr === null || item.dateStr === '') {
        await this.prisma.ipoLifecycleEvent.deleteMany({
          where: { ipoId, eventType: item.eventType },
        });
      } else {
        const d = new Date(item.dateStr);
        await this.prisma.ipoLifecycleEvent.upsert({
          where: { ipoId_eventType: { ipoId, eventType: item.eventType } },
          update: { eventDate: d },
          create: { ipoId, eventType: item.eventType, eventDate: d },
        });
      }
    }
  }

  private async recordFieldProvenance(
    ipoId: string,
    companyId: string,
    dto: Record<string, any>,
    sourceId: string,
    reference: string,
  ) {
    const now = new Date();
    const records: Array<{
      entityType: 'IPO' | 'COMPANY';
      entityId: string;
      fieldName: string;
      value: string;
    }> = [];

    if (dto.legalName)
      records.push({
        entityType: 'COMPANY',
        entityId: companyId,
        fieldName: 'company.legal_name',
        value: String(dto.legalName),
      });
    if (dto.cin)
      records.push({
        entityType: 'COMPANY',
        entityId: companyId,
        fieldName: 'company.cin',
        value: String(dto.cin),
      });
    if (dto.priceBandLow !== undefined && dto.priceBandLow !== null)
      records.push({
        entityType: 'IPO',
        entityId: ipoId,
        fieldName: 'price_band_low',
        value: String(dto.priceBandLow),
      });
    if (dto.priceBandHigh !== undefined && dto.priceBandHigh !== null)
      records.push({
        entityType: 'IPO',
        entityId: ipoId,
        fieldName: 'price_band_high',
        value: String(dto.priceBandHigh),
      });
    if (dto.lotSize !== undefined && dto.lotSize !== null)
      records.push({
        entityType: 'IPO',
        entityId: ipoId,
        fieldName: 'lot_size',
        value: String(dto.lotSize),
      });
    if (dto.issueSize !== undefined && dto.issueSize !== null)
      records.push({
        entityType: 'IPO',
        entityId: ipoId,
        fieldName: 'issue_size',
        value: String(dto.issueSize),
      });

    for (const r of records) {
      await this.prisma.fieldProvenance.create({
        data: {
          entityType: r.entityType,
          entityId: r.entityId,
          fieldName: r.fieldName,
          value: r.value,
          sourceId,
          sourceReference: reference,
          retrievedAt: now,
          confidence: new Prisma.Decimal(1.0),
        },
      });
    }
  }
}
