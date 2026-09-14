import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentType,
  ExchangeListing,
  IpoStatus,
  MarketSegment,
  OfferCategoryType,
  ParticipantRole,
  Prisma,
  PublicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { deriveIpoStatus } from '../discovery/canonicalizer.service';
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
          website: dto.website?.trim() || null,
          industry: dto.industry?.trim() || null,
          sector: dto.sector?.trim() || null,
          aboutDescription: dto.aboutDescription?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          contactPerson: dto.contactPerson?.trim() || null,
          logoUrl: dto.logoUrl?.trim() || null,
        },
      });
    } else {
      await this.prisma.company.update({
        where: { id: company.id },
        data: {
          ...(dto.website !== undefined ? { website: dto.website?.trim() || null } : {}),
          ...(dto.industry !== undefined ? { industry: dto.industry?.trim() || null } : {}),
          ...(dto.sector !== undefined ? { sector: dto.sector?.trim() || null } : {}),
          ...(dto.aboutDescription !== undefined ? { aboutDescription: dto.aboutDescription?.trim() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
          ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
          ...(dto.contactPerson !== undefined ? { contactPerson: dto.contactPerson?.trim() || null } : {}),
          ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl?.trim() || null } : {}),
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
      allotmentDate: dto.allotmentDate,
    });

    if (dto.offerCategories && dto.offerCategories.length > 0) {
      await this.saveOfferCategories(ipo.id, dto.offerCategories);
    }
    if (dto.financials && dto.financials.length > 0) {
      await this.saveFinancials(company.id, dto.financials);
    }
    if (dto.participants && dto.participants.length > 0) {
      await this.saveParticipants(ipo.id, dto.participants);
    }
    if (dto.allotmentConfig) {
      await this.configureAllotment(ipo.id, dto.allotmentConfig);
    }
    if (dto.gmp) {
      await this.saveGmpObservation(ipo.id, dto.gmp, adminSourceId);
    }
    if (dto.subscription && dto.subscription.length > 0) {
      await this.saveSubscriptionObservations(ipo.id, dto.subscription, adminSourceId);
    }

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

    // Update company if any company field is provided
    if (
      dto.legalName ||
      dto.displayName ||
      dto.cin !== undefined ||
      dto.website !== undefined ||
      dto.industry !== undefined ||
      dto.sector !== undefined ||
      dto.aboutDescription !== undefined ||
      dto.phone !== undefined ||
      dto.email !== undefined ||
      dto.contactPerson !== undefined ||
      dto.logoUrl !== undefined
    ) {
      await this.prisma.company.update({
        where: { id: existing.companyId },
        data: {
          ...(dto.legalName ? { legalName: dto.legalName.trim() } : {}),
          ...(dto.displayName ? { displayName: dto.displayName.trim() } : {}),
          ...(dto.cin !== undefined ? { cin: dto.cin?.trim() || null } : {}),
          ...(dto.website !== undefined ? { website: dto.website?.trim() || null } : {}),
          ...(dto.industry !== undefined ? { industry: dto.industry?.trim() || null } : {}),
          ...(dto.sector !== undefined ? { sector: dto.sector?.trim() || null } : {}),
          ...(dto.aboutDescription !== undefined ? { aboutDescription: dto.aboutDescription?.trim() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
          ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
          ...(dto.contactPerson !== undefined ? { contactPerson: dto.contactPerson?.trim() || null } : {}),
          ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl?.trim() || null } : {}),
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
      dto.listingDate !== undefined ||
      dto.allotmentDate !== undefined
    ) {
      await this.updateLifecycleEvents(id, {
        openDate: dto.openDate,
        closeDate: dto.closeDate,
        listingDate: dto.listingDate,
        allotmentDate: dto.allotmentDate,
      });
    }

    if (dto.offerCategories !== undefined) {
      await this.saveOfferCategories(id, dto.offerCategories);
    }
    if (dto.financials !== undefined) {
      await this.saveFinancials(existing.companyId, dto.financials);
    }
    if (dto.participants !== undefined) {
      await this.saveParticipants(id, dto.participants);
    }
    if (dto.allotmentConfig !== undefined) {
      await this.configureAllotment(id, dto.allotmentConfig);
    }
    if (dto.gmp !== undefined && dto.gmp !== null) {
      await this.saveGmpObservation(id, dto.gmp, adminSourceId);
    }
    if (dto.subscription !== undefined) {
      await this.saveSubscriptionObservations(id, dto.subscription, adminSourceId);
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
        company: {
          include: {
            financials: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        lifecycleEvents: true,
        documents: true,
        allotmentConfig: true,
        offerCategories: true,
        participants: {
          orderBy: { displayOrder: 'asc' },
        },
        gmpObservations: {
          orderBy: { observedAt: 'desc' },
          take: 1,
        },
        subscriptionObservations: {
          orderBy: { observedAt: 'desc' },
          take: 20,
        },
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
    const allotmentEvent = ipo.lifecycleEvents.find(
      (e) => e.eventType === 'BASIS_OF_ALLOTMENT',
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
      allotmentDate: allotmentEvent ? allotmentEvent.eventDate.toISOString() : null,
    });

    return {
      id: ipo.id,
      companyId: ipo.companyId,
      company: {
        legalName: ipo.company.legalName,
        displayName: ipo.company.displayName,
        cin: ipo.company.cin,
        logoUrl: ipo.company.logoUrl,
        website: ipo.company.website,
        industry: ipo.company.industry,
        sector: ipo.company.sector,
        aboutDescription: ipo.company.aboutDescription,
        phone: ipo.company.phone,
        email: ipo.company.email,
        contactPerson: ipo.company.contactPerson,
        financials: ipo.company.financials,
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
      allotmentDate: allotmentEvent
        ? allotmentEvent.eventDate.toISOString().slice(0, 10)
        : null,
      documents: ipo.documents,
      allotmentConfig: ipo.allotmentConfig,
      offerCategories: ipo.offerCategories,
      financials: ipo.company.financials,
      participants: ipo.participants,
      gmpObservations: ipo.gmpObservations,
      subscriptionObservations: ipo.subscriptionObservations,
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
   * Imports an IPO from canonical JSON payload.
   * Forces publicationStatus = DRAFT.
   * Performs full payload validation and atomic transactional database writes.
   */
  async importIpoFromJson(payload: any, targetIpoId?: string) {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Invalid JSON payload structure');
    }

    const companyData = payload.company || {};
    const ipoData = payload.ipo || {};
    const lifecycleData = payload.lifecycle || {};
    const allotmentConfigData = payload.allotmentConfig || {};
    const gmpData = payload.gmp || {};

    // 1. Mandatory Identity & Enums
    const legalName = (
      companyData.legalName ||
      companyData.displayName ||
      companyData.companyName ||
      payload.companyName
    )?.trim();
    if (!legalName) {
      throw new BadRequestException('Company name (legalName or companyName) is required in JSON payload');
    }

    // Exchange Normalization
    const rawExchange = String(
      payload.exchange || ipoData.exchange || companyData.exchange || 'NSE',
    ).trim();
    let exchange: ExchangeListing = ExchangeListing.NSE;
    if (
      rawExchange.toUpperCase().includes('BOTH') ||
      (rawExchange.toUpperCase().includes('BSE') && rawExchange.toUpperCase().includes('NSE'))
    ) {
      exchange = ExchangeListing.BOTH;
    } else if (rawExchange.toUpperCase().includes('NSE')) {
      exchange = ExchangeListing.NSE;
    } else if (rawExchange.toUpperCase().includes('BSE')) {
      exchange = ExchangeListing.BSE;
    } else if (Object.values(ExchangeListing).includes(rawExchange as ExchangeListing)) {
      exchange = rawExchange as ExchangeListing;
    } else {
      throw new BadRequestException(`Invalid exchange: ${rawExchange}`);
    }

    // Market Segment / Issue Type Normalization
    const rawSegment = String(
      payload.issueType || ipoData.issueType || ipoData.marketSegment || companyData.marketSegment || 'MAINBOARD',
    ).trim();
    let marketSegment: MarketSegment = MarketSegment.MAINBOARD;
    if (rawSegment.toUpperCase().includes('SME')) {
      marketSegment = MarketSegment.SME;
    } else if (
      rawSegment.toUpperCase().includes('MAINBOARD') ||
      rawSegment.toUpperCase().includes('MAIN')
    ) {
      marketSegment = MarketSegment.MAINBOARD;
    } else if (Object.values(MarketSegment).includes(rawSegment as MarketSegment)) {
      marketSegment = rawSegment as MarketSegment;
    } else {
      throw new BadRequestException(`Invalid issueType / marketSegment: ${rawSegment}`);
    }

    const status: IpoStatus = ipoData.status || IpoStatus.DRAFT;
    if (!Object.values(IpoStatus).includes(status)) {
      throw new BadRequestException(`Invalid status: ${ipoData.status}`);
    }

    // 2. Validate Price Band
    const priceBandLowVal = ipoData.priceBandLow ?? ipoData.priceBandMin ?? payload.priceBandMin;
    const priceBandHighVal = ipoData.priceBandHigh ?? ipoData.priceBandMax ?? payload.priceBandMax;

    if (
      priceBandLowVal !== undefined &&
      priceBandLowVal !== null &&
      priceBandHighVal !== undefined &&
      priceBandHighVal !== null
    ) {
      if (Number(priceBandLowVal) > Number(priceBandHighVal)) {
        throw new BadRequestException(
          `priceBandLow/Min (${priceBandLowVal}) cannot be greater than priceBandHigh/Max (${priceBandHighVal})`,
        );
      }
    }

    // 3. Validate Monetary Sizes & Share Counts consistency
    const freshIssueSizeVal = ipoData.freshIssueSize ?? payload.freshIssueSize;
    const ofsSizeVal = ipoData.ofsSize ?? payload.ofsSize;
    const issueSizeVal = ipoData.issueSize ?? payload.issueSize;

    if (
      freshIssueSizeVal !== undefined &&
      freshIssueSizeVal !== null &&
      ofsSizeVal !== undefined &&
      ofsSizeVal !== null &&
      issueSizeVal !== undefined &&
      issueSizeVal !== null
    ) {
      if (Number(issueSizeVal) < Number(freshIssueSizeVal) + Number(ofsSizeVal)) {
        throw new BadRequestException(
          'issueSize cannot be less than the sum of freshIssueSize and ofsSize',
        );
      }
    }

    const freshIssueShareCountVal = ipoData.freshIssueShareCount ?? payload.freshIssueShareCount;
    const ofsShareCountVal = ipoData.ofsShareCount ?? payload.ofsShareCount;
    const issueShareCountVal = ipoData.issueShareCount ?? payload.issueShareCount;

    if (
      freshIssueShareCountVal !== undefined &&
      freshIssueShareCountVal !== null &&
      ofsShareCountVal !== undefined &&
      ofsShareCountVal !== null &&
      issueShareCountVal !== undefined &&
      issueShareCountVal !== null
    ) {
      if (Number(issueShareCountVal) < Number(freshIssueShareCountVal) + Number(ofsShareCountVal)) {
        throw new BadRequestException(
          'issueShareCount cannot be less than the sum of freshIssueShareCount and ofsShareCount',
        );
      }
    }

    // 4. Validate Dates
    const parseDateStr = (dateStr?: string | null): Date | null => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid date string: ${dateStr}`);
      }
      return d;
    };

    const openDate = parseDateStr(payload.openDate || lifecycleData.openDate || ipoData.openDate);
    const closeDate = parseDateStr(payload.closeDate || lifecycleData.closeDate || ipoData.closeDate);
    const allotmentDate = parseDateStr(payload.allotmentDate || lifecycleData.allotmentDate || ipoData.allotmentDate);
    const listingDate = parseDateStr(payload.listingDate || lifecycleData.listingDate || ipoData.listingDate);
    const drhpDate = parseDateStr(payload.drhpDate || lifecycleData.drhpDate);
    const rhpDate = parseDateStr(payload.rhpDate || lifecycleData.rhpDate);
    const anchorDate = parseDateStr(payload.anchorDate || lifecycleData.anchorDate);

    if (openDate && closeDate && openDate > closeDate) {
      throw new BadRequestException('openDate cannot be after closeDate');
    }
    if (openDate && listingDate && openDate > listingDate) {
      throw new BadRequestException('openDate cannot be after listingDate');
    }

    // 5. Target IPO Safety Overwrite Check
    let existingIpo: any = null;
    if (targetIpoId) {
      existingIpo = await this.prisma.ipo.findUnique({
        where: { id: targetIpoId },
        include: { company: true },
      });
      if (!existingIpo) {
        throw new NotFoundException(`Target IPO ${targetIpoId} not found`);
      }
      if (
        existingIpo.publicationStatus === PublicationStatus.PUBLISHED ||
        existingIpo.publicationStatus === PublicationStatus.ARCHIVED
      ) {
        throw new BadRequestException(
          `Cannot overwrite a ${existingIpo.publicationStatus} IPO via JSON import. Unpublish first.`,
        );
      }
    }

    // 6. Company Identity & Ambiguity Check
    const cin = companyData.cin?.trim() || payload.cin?.trim() || null;
    let company: any = null;

    if (existingIpo) {
      company = existingIpo.company;
    } else {
      const companyByCin = cin
        ? await this.prisma.company.findUnique({ where: { cin } })
        : null;
      const companyByName = await this.prisma.company.findFirst({
        where: { legalName: { equals: legalName, mode: 'insensitive' } },
      });

      if (companyByCin && companyByName && companyByCin.id !== companyByName.id) {
        throw new BadRequestException(
          `Ambiguous company match: CIN '${cin}' and Legal Name '${legalName}' match different existing companies.`,
        );
      }

      company = companyByCin || companyByName;
    }

    // 7. Atomic Transactional DB Creation / Update
    const adminSourceId = await this.getAdminSourceId();

    const logoUrl = (payload.logoUrl || companyData.logoUrl)?.trim() || null;
    const companyPhone = (payload.companyPhone || payload.phone || companyData.companyPhone || companyData.phone)?.trim() || null;
    const companyEmail = (payload.companyEmail || payload.email || companyData.companyEmail || companyData.email)?.trim() || null;
    const contactPerson = (companyData.contactPerson || payload.contactPerson)?.trim() || null;
    const website = (payload.website || companyData.website)?.trim() || null;
    const industry = (payload.industry || companyData.industry)?.trim() || null;
    const sector = (payload.sector || companyData.sector)?.trim() || null;
    const aboutDescription = (companyData.aboutDescription || payload.aboutDescription || payload.notes || companyData.notes || ipoData.notes)?.trim() || null;

    const createdOrUpdatedIpo = await this.prisma.$transaction(async (tx) => {
      // Upsert / Update Company
      if (!company) {
        company = await tx.company.create({
          data: {
            legalName,
            displayName: companyData.displayName?.trim() || legalName,
            cin,
            aboutDescription,
            website,
            email: companyEmail,
            phone: companyPhone,
            contactPerson,
            industry,
            sector,
            logoUrl,
          },
        });
      } else {
        company = await tx.company.update({
          where: { id: company.id },
          data: {
            legalName,
            displayName:
              companyData.displayName?.trim() || company.displayName || legalName,
            ...(cin ? { cin } : {}),
            ...(aboutDescription !== null ? { aboutDescription } : {}),
            ...(website !== null ? { website } : {}),
            ...(companyEmail !== null ? { email: companyEmail } : {}),
            ...(companyPhone !== null ? { phone: companyPhone } : {}),
            ...(contactPerson !== null ? { contactPerson } : {}),
            ...(industry !== null ? { industry } : {}),
            ...(sector !== null ? { sector } : {}),
            ...(logoUrl !== null ? { logoUrl } : {}),
          },
        });
      }

      // Upsert Company Financials Array
      const financialsArray = companyData.financials || payload.financials || [];
      if (Array.isArray(financialsArray) && financialsArray.length > 0) {
        for (const fin of financialsArray) {
          const fiscalPeriod = (fin.fiscalPeriod || fin.fiscalYear || '').toString().trim();
          if (!fiscalPeriod) continue;
          const totalRevenue = fin.totalRevenue !== undefined && fin.totalRevenue !== null ? fin.totalRevenue : fin.revenue;
          const pat = fin.pat !== undefined && fin.pat !== null ? fin.pat : fin.netProfit;
          const netWorth = fin.netWorth !== undefined && fin.netWorth !== null ? fin.netWorth : (fin.nav || fin.ronw);
          const roePercentage = fin.roePercentage !== undefined && fin.roePercentage !== null ? fin.roePercentage : fin.roePercent;
          const patMarginPercent = fin.patMarginPercent !== undefined && fin.patMarginPercent !== null ? fin.patMarginPercent : fin.patPercent;

          await tx.companyFinancial.upsert({
            where: {
              companyId_fiscalPeriod_periodType: {
                companyId: company.id,
                fiscalPeriod,
                periodType: fin.periodType || 'ANNUAL',
              },
            },
            update: {
              totalAssets:
                fin.totalAssets !== undefined && fin.totalAssets !== null
                  ? new Prisma.Decimal(fin.totalAssets)
                  : undefined,
              totalRevenue:
                totalRevenue !== undefined && totalRevenue !== null
                  ? new Prisma.Decimal(totalRevenue)
                  : undefined,
              pat:
                pat !== undefined && pat !== null
                  ? new Prisma.Decimal(pat)
                  : undefined,
              ebitda:
                fin.ebitda !== undefined && fin.ebitda !== null
                  ? new Prisma.Decimal(fin.ebitda)
                  : undefined,
              netWorth:
                netWorth !== undefined && netWorth !== null
                  ? new Prisma.Decimal(netWorth)
                  : undefined,
              roePercentage:
                roePercentage !== undefined && roePercentage !== null
                  ? new Prisma.Decimal(roePercentage)
                  : undefined,
              rocePercentage:
                fin.rocePercentage !== undefined && fin.rocePercentage !== null
                  ? new Prisma.Decimal(fin.rocePercentage)
                  : undefined,
              eps:
                fin.eps !== undefined && fin.eps !== null
                  ? new Prisma.Decimal(fin.eps)
                  : undefined,
              patMarginPercent:
                patMarginPercent !== undefined && patMarginPercent !== null
                  ? new Prisma.Decimal(patMarginPercent)
                  : undefined,
            },
            create: {
              companyId: company.id,
              fiscalPeriod,
              periodType: fin.periodType || 'ANNUAL',
              totalAssets:
                fin.totalAssets !== undefined && fin.totalAssets !== null
                  ? new Prisma.Decimal(fin.totalAssets)
                  : null,
              totalRevenue:
                totalRevenue !== undefined && totalRevenue !== null
                  ? new Prisma.Decimal(totalRevenue)
                  : null,
              pat:
                pat !== undefined && pat !== null
                  ? new Prisma.Decimal(pat)
                  : null,
              ebitda:
                fin.ebitda !== undefined && fin.ebitda !== null
                  ? new Prisma.Decimal(fin.ebitda)
                  : null,
              netWorth:
                netWorth !== undefined && netWorth !== null
                  ? new Prisma.Decimal(netWorth)
                  : null,
              roePercentage:
                roePercentage !== undefined && roePercentage !== null
                  ? new Prisma.Decimal(roePercentage)
                  : null,
              rocePercentage:
                fin.rocePercentage !== undefined && fin.rocePercentage !== null
                  ? new Prisma.Decimal(fin.rocePercentage)
                  : null,
              eps:
                fin.eps !== undefined && fin.eps !== null
                  ? new Prisma.Decimal(fin.eps)
                  : null,
              patMarginPercent:
                patMarginPercent !== undefined && patMarginPercent !== null
                  ? new Prisma.Decimal(patMarginPercent)
                  : null,
            },
          });
        }
      }

      // Force publicationStatus = DRAFT ALWAYS
      const derivedStatus = deriveIpoStatus({
        explicitStatus: status,
        openDate: openDate?.toISOString(),
        closeDate: closeDate?.toISOString(),
      });

      const symbolVal = (payload.symbol || ipoData.symbol || companyData.symbol)?.trim() || null;
      const faceValueVal = ipoData.faceValue ?? payload.faceValue;

      const ipoPayload: Prisma.IpoUncheckedCreateInput = {
        companyId: company.id,
        marketSegment,
        exchange,
        status: derivedStatus,
        publicationStatus: PublicationStatus.DRAFT,
        symbol: symbolVal,
        priceBandLow:
          priceBandLowVal !== undefined && priceBandLowVal !== null
            ? new Prisma.Decimal(priceBandLowVal)
            : null,
        priceBandHigh:
          priceBandHighVal !== undefined && priceBandHighVal !== null
            ? new Prisma.Decimal(priceBandHighVal)
            : null,
        lotSize: ipoData.lotSize ?? payload.lotSize ?? null,
        faceValue:
          faceValueVal !== undefined && faceValueVal !== null
            ? new Prisma.Decimal(faceValueVal)
            : null,
        issueSize:
          issueSizeVal !== undefined && issueSizeVal !== null
            ? new Prisma.Decimal(issueSizeVal)
            : null,
        freshIssueSize:
          freshIssueSizeVal !== undefined && freshIssueSizeVal !== null
            ? new Prisma.Decimal(freshIssueSizeVal)
            : null,
        ofsSize:
          ofsSizeVal !== undefined && ofsSizeVal !== null
            ? new Prisma.Decimal(ofsSizeVal)
            : null,
        issueShareCount: issueShareCountVal || null,
        freshIssueShareCount: freshIssueShareCountVal || null,
        ofsShareCount: ofsShareCountVal || null,
      };

      let ipo;
      if (existingIpo) {
        ipo = await tx.ipo.update({
          where: { id: existingIpo.id },
          data: ipoPayload,
        });
      } else {
        ipo = await tx.ipo.create({
          data: ipoPayload,
        });
      }

      // Link to ADMIN source identity
      await tx.ipoSourceIdentity.upsert({
        where: {
          ipoId_sourceId: { ipoId: ipo.id, sourceId: adminSourceId },
        },
        update: { symbol: ipo.symbol },
        create: {
          ipoId: ipo.id,
          sourceId: adminSourceId,
          externalId: ipo.id,
          symbol: ipo.symbol,
        },
      });

      // Update Lifecycle Events
      const events: Array<{ type: any; date: Date | null }> = [
        { type: 'DRHP', date: drhpDate },
        { type: 'RHP', date: rhpDate },
        { type: 'ANCHOR', date: anchorDate },
        { type: 'OPEN', date: openDate },
        { type: 'CLOSE', date: closeDate },
        { type: 'BASIS_OF_ALLOTMENT', date: allotmentDate },
        { type: 'LISTING', date: listingDate },
      ];

      for (const ev of events) {
        if (ev.date) {
          await tx.ipoLifecycleEvent.upsert({
            where: {
              ipoId_eventType: { ipoId: ipo.id, eventType: ev.type },
            },
            update: { eventDate: ev.date },
            create: { ipoId: ipo.id, eventType: ev.type, eventDate: ev.date },
          });
        }
      }

      // Offer Categories
      const categoriesArray = payload.offerCategories || ipoData.offerCategories || [];
      if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
        for (const cat of categoriesArray) {
          const category = cat.category || cat.categoryCode;
          if (!category) continue;
          const allocationPct = cat.allocationPct !== undefined && cat.allocationPct !== null ? cat.allocationPct : cat.allocationPercentage;
          await tx.ipoOfferCategory.upsert({
            where: {
              ipoId_category: { ipoId: ipo.id, category },
            },
            update: {
              allocationPct:
                allocationPct !== undefined && allocationPct !== null
                  ? new Prisma.Decimal(allocationPct)
                  : undefined,
              minLots: cat.minLots ?? undefined,
              maxLots: cat.maxLots ?? undefined,
              minShares: cat.minShares ?? undefined,
              maxShares: cat.maxShares ?? undefined,
              minAmount:
                cat.minAmount !== undefined && cat.minAmount !== null
                  ? new Prisma.Decimal(cat.minAmount)
                  : undefined,
              maxAmount:
                cat.maxAmount !== undefined && cat.maxAmount !== null
                  ? new Prisma.Decimal(cat.maxAmount)
                  : undefined,
              isUpiEligible: cat.isUpiEligible ?? true,
            },
            create: {
              ipoId: ipo.id,
              category,
              allocationPct:
                allocationPct !== undefined && allocationPct !== null
                  ? new Prisma.Decimal(allocationPct)
                  : null,
              minLots: cat.minLots || null,
              maxLots: cat.maxLots || null,
              minShares: cat.minShares || null,
              maxShares: cat.maxShares || null,
              minAmount:
                cat.minAmount !== undefined && cat.minAmount !== null
                  ? new Prisma.Decimal(cat.minAmount)
                  : null,
              maxAmount:
                cat.maxAmount !== undefined && cat.maxAmount !== null
                  ? new Prisma.Decimal(cat.maxAmount)
                  : null,
              isUpiEligible: cat.isUpiEligible ?? true,
            },
          });
        }
      }

      // Participants (Registrar, Lead Manager, explicitly listed participants)
      const registrarName = (payload.registrar || allotmentConfigData.registrar || companyData.registrar)?.trim();
      const registrarPhone = (payload.registrarPhone || allotmentConfigData.registrarPhone)?.trim() || null;
      const registrarEmail = (payload.registrarEmail || allotmentConfigData.registrarEmail)?.trim() || null;

      if (registrarName) {
        await tx.ipoParticipant.create({
          data: {
            ipoId: ipo.id,
            role: ParticipantRole.REGISTRAR,
            name: registrarName,
            phone: registrarPhone,
            email: registrarEmail,
            displayOrder: 1,
          },
        });
      }

      const leadManagerName = (payload.leadManager || companyData.leadManager)?.trim();
      if (leadManagerName) {
        await tx.ipoParticipant.create({
          data: {
            ipoId: ipo.id,
            role: ParticipantRole.BRLM,
            name: leadManagerName,
            displayOrder: 2,
          },
        });
      }

      if (Array.isArray(payload.participants) && payload.participants.length > 0) {
        for (const part of payload.participants) {
          if (!part.role || !part.name) continue;
          await tx.ipoParticipant.create({
            data: {
              ipoId: ipo.id,
              role: part.role,
              name: part.name.trim(),
              phone: part.phone?.trim() || null,
              email: part.email?.trim() || null,
              website: part.website?.trim() || null,
              displayOrder: part.displayOrder || 0,
            },
          });
        }
      }

      // Allotment Config
      if (registrarName) {
        await tx.ipoAllotmentConfig.upsert({
          where: { ipoId: ipo.id },
          update: {
            registrar: registrarName,
            registrarIpoCode: allotmentConfigData.registrarIpoCode?.trim() || null,
            allotmentSourceUrl: allotmentConfigData.allotmentSourceUrl?.trim() || null,
            expectedAllotmentDate: allotmentConfigData.expectedAllotmentDate || allotmentDate
              ? new Date(allotmentConfigData.expectedAllotmentDate || allotmentDate!)
              : undefined,
            enabled: allotmentConfigData.enabled ?? true,
          },
          create: {
            ipoId: ipo.id,
            registrar: registrarName,
            registrarIpoCode: allotmentConfigData.registrarIpoCode?.trim() || null,
            allotmentSourceUrl: allotmentConfigData.allotmentSourceUrl?.trim() || null,
            expectedAllotmentDate: allotmentConfigData.expectedAllotmentDate || allotmentDate
              ? new Date(allotmentConfigData.expectedAllotmentDate || allotmentDate!)
              : null,
            enabled: allotmentConfigData.enabled ?? true,
          },
        });
      }

      // Documents (DRHP, RHP, or array)
      const drhpUrl = (payload.drhpUrl || ipoData.drhpUrl)?.trim();
      if (drhpUrl) {
        await tx.ipoDocument.create({
          data: {
            ipoId: ipo.id,
            documentType: DocumentType.DRHP,
            fileName: 'DRHP Document',
            sourceUrl: drhpUrl,
            source: 'MANUAL_IMPORT',
            parsingStatus: 'PARSED',
          },
        });
      }

      const rhpUrl = (payload.rhpUrl || ipoData.rhpUrl)?.trim();
      if (rhpUrl) {
        await tx.ipoDocument.create({
          data: {
            ipoId: ipo.id,
            documentType: DocumentType.RHP,
            fileName: 'RHP Document',
            sourceUrl: rhpUrl,
            source: 'MANUAL_IMPORT',
            parsingStatus: 'PARSED',
          },
        });
      }

      if (Array.isArray(payload.documents) && payload.documents.length > 0) {
        for (const doc of payload.documents) {
          if (!doc.documentType) continue;
          const sourceUrl = doc.sourceUrl || doc.url;
          await tx.ipoDocument.create({
            data: {
              ipoId: ipo.id,
              documentType: doc.documentType,
              fileName: doc.fileName?.trim() || doc.title?.trim() || null,
              sourceUrl: sourceUrl?.trim() || null,
              source: 'MANUAL_IMPORT',
              parsingStatus: 'PARSED',
            },
          });
        }
      }

      // GMP Observation
      const gmpAmt = payload.gmpAmount ?? gmpData.gmpAmount;
      const gmpPct = payload.gmpPercent ?? gmpData.gmpPercent ?? gmpData.gmpPercentage;

      if (gmpAmt !== undefined && gmpAmt !== null) {
        await tx.gmpObservation.create({
          data: {
            ipoId: ipo.id,
            gmpAmount: new Prisma.Decimal(gmpAmt),
            gmpPercentage:
              gmpPct !== undefined && gmpPct !== null
                ? new Prisma.Decimal(gmpPct)
                : null,
            estProfitPerLot:
              gmpData.estProfitPerLot !== undefined && gmpData.estProfitPerLot !== null
                ? new Prisma.Decimal(gmpData.estProfitPerLot)
                : null,
            sourceId: adminSourceId,
            observedAt: gmpData.observedAt
              ? new Date(gmpData.observedAt)
              : new Date(),
          },
        });
      }

      // Subscription Observations
      const subItems = Array.isArray(payload.subscription)
        ? payload.subscription
        : payload.subscription && typeof payload.subscription === 'object'
          ? [
              ...(payload.subscription.qibx ? [{ category: 'QIB', subscriptionMultiple: payload.subscription.qibx }] : []),
              ...(payload.subscription.nii ? [{ category: 'NII', subscriptionMultiple: payload.subscription.nii }] : []),
              ...(payload.subscription.bNii ? [{ category: 'NII', subscriptionMultiple: payload.subscription.bNii }] : []),
              ...(payload.subscription.sNii ? [{ category: 'NII', subscriptionMultiple: payload.subscription.sNii }] : []),
              ...(payload.subscription.rii ? [{ category: 'RETAIL', subscriptionMultiple: payload.subscription.rii }] : []),
              ...(payload.subscription.employee ? [{ category: 'EMPLOYEE', subscriptionMultiple: payload.subscription.employee }] : []),
              ...(payload.subscription.shareholder ? [{ category: 'SHAREHOLDER', subscriptionMultiple: payload.subscription.shareholder }] : []),
            ]
          : [];

      if (subItems.length > 0) {
        for (const sub of subItems) {
          const rawCat = (sub.category || sub.categoryCode || '').toString().toUpperCase();
          const category = (rawCat === 'BNII' || rawCat === 'SNII') ? 'NII' : rawCat;
          if (
            !category ||
            !Object.values(OfferCategoryType).includes(category as OfferCategoryType)
          ) {
            continue;
          }
          if (
            sub.subscriptionMultiple !== undefined &&
            sub.subscriptionMultiple !== null
          ) {
            await tx.subscriptionObservation.create({
              data: {
                ipoId: ipo.id,
                category: category as OfferCategoryType,
                subscriptionMultiple: new Prisma.Decimal(sub.subscriptionMultiple),
                sharesBid: sub.sharesBid ? new Prisma.Decimal(sub.sharesBid) : null,
                sharesOffered: sub.sharesOffered ? new Prisma.Decimal(sub.sharesOffered) : null,
                sourceId: adminSourceId,
                observedAt: sub.observedAt
                  ? new Date(sub.observedAt)
                  : payload.subscription?.asOf
                    ? new Date(payload.subscription.asOf)
                    : new Date(),
              },
            });
          }
        }
      }

      return ipo;
    });

    return {
      id: createdOrUpdatedIpo.id,
      publicationStatus: createdOrUpdatedIpo.publicationStatus,
      message: 'JSON import successful. IPO created/updated in DRAFT status.',
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
    dates: { openDate?: string; closeDate?: string; listingDate?: string; allotmentDate?: string },
  ) {
    const updates: Array<{ eventType: 'OPEN' | 'CLOSE' | 'LISTING' | 'BASIS_OF_ALLOTMENT'; dateStr?: string }> = [
      { eventType: 'OPEN', dateStr: dates.openDate },
      { eventType: 'CLOSE', dateStr: dates.closeDate },
      { eventType: 'LISTING', dateStr: dates.listingDate },
      { eventType: 'BASIS_OF_ALLOTMENT', dateStr: dates.allotmentDate },
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

  private async saveOfferCategories(ipoId: string, categories: any[]) {
    await this.prisma.ipoOfferCategory.deleteMany({ where: { ipoId } });
    for (const cat of categories) {
      if (!cat.category) continue;
      await this.prisma.ipoOfferCategory.create({
        data: {
          ipoId,
          category: cat.category,
          allocationPct: cat.allocationPct !== undefined && cat.allocationPct !== null ? new Prisma.Decimal(cat.allocationPct) : null,
          minLots: cat.minLots || null,
          maxLots: cat.maxLots || null,
          minShares: cat.minShares || null,
          maxShares: cat.maxShares || null,
          minAmount: cat.minAmount !== undefined && cat.minAmount !== null ? new Prisma.Decimal(cat.minAmount) : null,
          maxAmount: cat.maxAmount !== undefined && cat.maxAmount !== null ? new Prisma.Decimal(cat.maxAmount) : null,
          isUpiEligible: cat.isUpiEligible !== undefined ? !!cat.isUpiEligible : true,
        },
      });
    }
  }

  private async saveFinancials(companyId: string, financials: any[]) {
    await this.prisma.companyFinancial.deleteMany({ where: { companyId } });
    for (const fin of financials) {
      if (!fin.fiscalPeriod) continue;
      await this.prisma.companyFinancial.create({
        data: {
          companyId,
          fiscalPeriod: fin.fiscalPeriod,
          periodType: fin.periodType || 'ANNUAL',
          totalAssets: fin.totalAssets !== undefined && fin.totalAssets !== null ? new Prisma.Decimal(fin.totalAssets) : null,
          totalRevenue: fin.totalRevenue !== undefined && fin.totalRevenue !== null ? new Prisma.Decimal(fin.totalRevenue) : null,
          pat: fin.pat !== undefined && fin.pat !== null ? new Prisma.Decimal(fin.pat) : null,
          ebitda: fin.ebitda !== undefined && fin.ebitda !== null ? new Prisma.Decimal(fin.ebitda) : null,
          netWorth: fin.netWorth !== undefined && fin.netWorth !== null ? new Prisma.Decimal(fin.netWorth) : null,
          roePercentage: fin.roePercentage !== undefined && fin.roePercentage !== null ? new Prisma.Decimal(fin.roePercentage) : null,
          rocePercentage: fin.rocePercentage !== undefined && fin.rocePercentage !== null ? new Prisma.Decimal(fin.rocePercentage) : null,
          eps: fin.eps !== undefined && fin.eps !== null ? new Prisma.Decimal(fin.eps) : null,
          patMarginPercent: fin.patMarginPercent !== undefined && fin.patMarginPercent !== null ? new Prisma.Decimal(fin.patMarginPercent) : null,
        },
      });
    }
  }

  private async saveParticipants(ipoId: string, participants: any[]) {
    await this.prisma.ipoParticipant.deleteMany({ where: { ipoId } });
    for (const part of participants) {
      if (!part.name || !part.role) continue;
      await this.prisma.ipoParticipant.create({
        data: {
          ipoId,
          role: part.role,
          name: part.name.trim(),
          phone: part.phone?.trim() || null,
          email: part.email?.trim() || null,
          website: part.website?.trim() || null,
          displayOrder: part.displayOrder || 0,
        },
      });
    }
  }

  private async saveGmpObservation(ipoId: string, gmp: any, sourceId: string) {
    if (gmp.gmpAmount === undefined || gmp.gmpAmount === null) return;
    await this.prisma.gmpObservation.create({
      data: {
        ipoId,
        gmpAmount: new Prisma.Decimal(gmp.gmpAmount),
        gmpPercentage: gmp.gmpPercentage !== undefined && gmp.gmpPercentage !== null ? new Prisma.Decimal(gmp.gmpPercentage) : null,
        estProfitPerLot: gmp.estProfitPerLot !== undefined && gmp.estProfitPerLot !== null ? new Prisma.Decimal(gmp.estProfitPerLot) : null,
        sourceId,
        observedAt: gmp.observedAt ? new Date(gmp.observedAt) : new Date(),
      },
    });
  }

  private async saveSubscriptionObservations(ipoId: string, subscriptions: any[], sourceId: string) {
    const obsDate = new Date();
    for (const sub of subscriptions) {
      if (!sub.category || sub.subscriptionMultiple === undefined || sub.subscriptionMultiple === null) continue;
      await this.prisma.subscriptionObservation.create({
        data: {
          ipoId,
          category: sub.category,
          subscriptionMultiple: new Prisma.Decimal(sub.subscriptionMultiple),
          sharesBid: sub.sharesBid !== undefined && sub.sharesBid !== null ? new Prisma.Decimal(sub.sharesBid) : null,
          sharesOffered: sub.sharesOffered !== undefined && sub.sharesOffered !== null ? new Prisma.Decimal(sub.sharesOffered) : null,
          sourceId,
          observedAt: sub.observedAt ? new Date(sub.observedAt) : obsDate,
        },
      });
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

  /**
   * Delete an IPO permanently.
   */
  async deleteIpo(id: string) {
    const existing = await this.prisma.ipo.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`IPO with ID ${id} not found.`);
    }

    await this.prisma.gmpObservation.deleteMany({ where: { ipoId: id } });
    await this.prisma.subscriptionObservation.deleteMany({ where: { ipoId: id } });
    await this.prisma.ipoLifecycleEvent.deleteMany({ where: { ipoId: id } });
    await this.prisma.ipoOfferCategory.deleteMany({ where: { ipoId: id } });
    await this.prisma.ipoParticipant.deleteMany({ where: { ipoId: id } });
    await this.prisma.ipoSourceIdentity.deleteMany({ where: { ipoId: id } });
    await this.prisma.ipoDocument.deleteMany({ where: { ipoId: id } });
    await this.prisma.ipoAllotmentConfig.deleteMany({ where: { ipoId: id } });

    await this.prisma.ipo.delete({ where: { id } });

    return { id, message: 'IPO deleted permanently.' };
  }

  /**
   * Unarchive an IPO (revert to DRAFT).
   */
  async unarchiveIpo(id: string) {
    const updated = await this.prisma.ipo.update({
      where: { id },
      data: { publicationStatus: PublicationStatus.DRAFT },
    });

    return {
      id: updated.id,
      publicationStatus: updated.publicationStatus,
      message: 'IPO unarchived (reverted to DRAFT).',
    };
  }
}
