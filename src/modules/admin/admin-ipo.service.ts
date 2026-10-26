import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
import { normalizeName } from '../allotment/allotment.matching';
import {
  AdminIpoQueryDto,
  ConfigureAllotmentDto,
  CreateAdminIpoDto,
  FieldDiffSkipped,
  FieldDiffToFill,
  FieldReportItem,
  JsonImportCommitDto,
  JsonImportCommitResponse,
  JsonImportPreviewResponse,
  JsonIpoCommitResultItem,
  JsonIpoPreviewItem,
  UpdateAdminIpoDto,
} from './admin-ipo.dto';
import { AdminValidationService } from './admin-validation.service';
import { AdminProvenanceResolver } from './admin-provenance.resolver';
import { EnrichmentOrchestratorService } from '../enrichment/enrichment-orchestrator.service';
import { EnrichmentJobResult } from '../enrichment/enrichment.types';
import { AiResearchOrchestratorService } from '../enrichment/research/ai-research-orchestrator.service';
import { IpoReconciliationSummary, ResearchJob } from '../enrichment/research/research.types';

@Injectable()
export class AdminIpoService {
  private readonly logger = new Logger(AdminIpoService.name);
  private activeOverwriteMode = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: AdminValidationService,
    private readonly provenanceResolver: AdminProvenanceResolver,
    @Optional()
    private readonly enrichmentOrchestrator?: EnrichmentOrchestratorService,
    @Optional()
    private readonly aiResearchOrchestrator?: AiResearchOrchestratorService,
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

    // Check if Company already exists by CIN or Legal Name with strict ambiguity detection
    const cin = dto.cin?.trim() || null;
    let company: any = null;

    const companiesByCin = cin
      ? await this.prisma.company.findMany({
          where: { cin: { equals: cin, mode: 'insensitive' } },
        })
      : [];
    if (companiesByCin.length > 1) {
      throw new BadRequestException(
        `Ambiguous company match: multiple existing companies match CIN '${cin}'.`,
      );
    }
    const companyByCin = companiesByCin[0] || null;

    const companiesByName = await this.prisma.company.findMany({
      where: { legalName: { equals: legalName, mode: 'insensitive' } },
    });
    if (companiesByName.length > 1) {
      throw new BadRequestException(
        `Ambiguous company match: multiple existing companies match Legal Name '${legalName}'.`,
      );
    }
    const companyByName = companiesByName[0] || null;

    if (companyByCin && companyByName && companyByCin.id !== companyByName.id) {
      throw new BadRequestException(
        `Ambiguous company match: CIN '${cin}' and Legal Name '${legalName}' match different existing companies.`,
      );
    }
    if (cin && companyByName && companyByName.cin && companyByName.cin !== cin) {
      throw new BadRequestException(
        `Ambiguous company match: existing company with Legal Name '${legalName}' has CIN '${companyByName.cin}', which conflicts with supplied CIN '${cin}'.`,
      );
    }

    company = companyByCin || companyByName;

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
        listingPrice:
          dto.listingPrice !== undefined && dto.listingPrice !== null
            ? new Prisma.Decimal(dto.listingPrice)
            : null,
        listingGainPct: (() => {
          if (dto.listingGainPct !== undefined && dto.listingGainPct !== null) return new Prisma.Decimal(dto.listingGainPct);
          const issuePrice = dto.priceBandHigh || dto.priceBandLow || 0;
          if (dto.listingPrice && issuePrice > 0) {
            return new Prisma.Decimal((((dto.listingPrice - issuePrice) / issuePrice) * 100).toFixed(2));
          }
          return null;
        })(),
        profitAmount: (() => {
          if (dto.profitAmount !== undefined && dto.profitAmount !== null) return new Prisma.Decimal(dto.profitAmount);
          const issuePrice = dto.priceBandHigh || dto.priceBandLow || 0;
          if (dto.listingPrice && issuePrice > 0) {
            const lot = dto.lotSize || 1;
            return new Prisma.Decimal(((dto.listingPrice - issuePrice) * lot).toFixed(2));
          }
          return null;
        })(),
        profitPercentage: (() => {
          if (dto.profitPercentage !== undefined && dto.profitPercentage !== null) return new Prisma.Decimal(dto.profitPercentage);
          if (dto.listingGainPct !== undefined && dto.listingGainPct !== null) return new Prisma.Decimal(dto.listingGainPct);
          const issuePrice = dto.priceBandHigh || dto.priceBandLow || 0;
          if (dto.listingPrice && issuePrice > 0) {
            return new Prisma.Decimal((((dto.listingPrice - issuePrice) / issuePrice) * 100).toFixed(2));
          }
          return null;
        })(),
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
        preIpoEps: dto.preIpoEps !== undefined && dto.preIpoEps !== null ? new Prisma.Decimal(dto.preIpoEps) : null,
        postIpoEps: dto.postIpoEps !== undefined && dto.postIpoEps !== null ? new Prisma.Decimal(dto.postIpoEps) : null,
        preIpoPe: dto.preIpoPe !== undefined && dto.preIpoPe !== null ? new Prisma.Decimal(dto.preIpoPe) : null,
        postIpoPe: dto.postIpoPe !== undefined && dto.postIpoPe !== null ? new Prisma.Decimal(dto.postIpoPe) : null,
        preIpoPromoterHolding: dto.preIpoPromoterHolding !== undefined && dto.preIpoPromoterHolding !== null ? new Prisma.Decimal(dto.preIpoPromoterHolding) : null,
        postIpoPromoterHolding: dto.postIpoPromoterHolding !== undefined && dto.postIpoPromoterHolding !== null ? new Prisma.Decimal(dto.postIpoPromoterHolding) : null,
        preIpoMarketCap: dto.preIpoMarketCap !== undefined && dto.preIpoMarketCap !== null ? new Prisma.Decimal(dto.preIpoMarketCap) : null,
        postIpoMarketCap: dto.postIpoMarketCap !== undefined && dto.postIpoMarketCap !== null ? new Prisma.Decimal(dto.postIpoMarketCap) : null,
      },
      include: { company: true },
    });

    // Create lifecycle events if dates provided
    await this.updateLifecycleEvents(ipo.id, {
      openDate: dto.openDate,
      closeDate: dto.closeDate,
      listingDate: dto.listingDate,
      allotmentDate: dto.allotmentDate,
      refundDate: dto.refundDate,
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
    await this.saveDocuments(ipo.id, dto);

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
      (dto.legalName && dto.legalName.trim() !== '') ||
      (dto.displayName && dto.displayName.trim() !== '') ||
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
          ...(dto.legalName && dto.legalName.trim() !== '' ? { legalName: dto.legalName.trim() } : {}),
          ...(dto.displayName && dto.displayName.trim() !== '' ? { displayName: dto.displayName.trim() } : {}),
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
        ...(dto.listingPrice !== undefined
          ? {
              listingPrice:
                dto.listingPrice !== null
                  ? new Prisma.Decimal(dto.listingPrice)
                  : null,
            }
          : {}),
        ...(dto.listingGainPct !== undefined
          ? {
              listingGainPct:
                dto.listingGainPct !== null
                  ? new Prisma.Decimal(dto.listingGainPct)
                  : null,
            }
          : (dto.listingPrice !== undefined && dto.listingPrice !== null ? {
              listingGainPct: (() => {
                const issuePrice = dto.priceBandHigh || (existing.priceBandHigh ? Number(existing.priceBandHigh) : (dto.priceBandLow || (existing.priceBandLow ? Number(existing.priceBandLow) : 0)));
                return issuePrice > 0 ? new Prisma.Decimal((((dto.listingPrice - issuePrice) / issuePrice) * 100).toFixed(2)) : null;
              })()
            } : {})),
        ...(dto.profitAmount !== undefined
          ? {
              profitAmount:
                dto.profitAmount !== null
                  ? new Prisma.Decimal(dto.profitAmount)
                  : null,
            }
          : (dto.listingPrice !== undefined && dto.listingPrice !== null ? {
              profitAmount: (() => {
                const issuePrice = dto.priceBandHigh || (existing.priceBandHigh ? Number(existing.priceBandHigh) : (dto.priceBandLow || (existing.priceBandLow ? Number(existing.priceBandLow) : 0)));
                const lot = dto.lotSize || existing.lotSize || 1;
                return issuePrice > 0 ? new Prisma.Decimal(((dto.listingPrice - issuePrice) * lot).toFixed(2)) : null;
              })()
            } : {})),
        ...(dto.profitPercentage !== undefined
          ? {
              profitPercentage:
                dto.profitPercentage !== null
                  ? new Prisma.Decimal(dto.profitPercentage)
                  : null,
            }
          : (dto.listingPrice !== undefined && dto.listingPrice !== null ? {
              profitPercentage: (() => {
                const issuePrice = dto.priceBandHigh || (existing.priceBandHigh ? Number(existing.priceBandHigh) : (dto.priceBandLow || (existing.priceBandLow ? Number(existing.priceBandLow) : 0)));
                return issuePrice > 0 ? new Prisma.Decimal((((dto.listingPrice - issuePrice) / issuePrice) * 100).toFixed(2)) : null;
              })()
            } : {})),
        ...(dto.preIpoEps !== undefined ? { preIpoEps: dto.preIpoEps !== null ? new Prisma.Decimal(dto.preIpoEps) : null } : {}),
        ...(dto.postIpoEps !== undefined ? { postIpoEps: dto.postIpoEps !== null ? new Prisma.Decimal(dto.postIpoEps) : null } : {}),
        ...(dto.preIpoPe !== undefined ? { preIpoPe: dto.preIpoPe !== null ? new Prisma.Decimal(dto.preIpoPe) : null } : {}),
        ...(dto.postIpoPe !== undefined ? { postIpoPe: dto.postIpoPe !== null ? new Prisma.Decimal(dto.postIpoPe) : null } : {}),
        ...(dto.preIpoPromoterHolding !== undefined ? { preIpoPromoterHolding: dto.preIpoPromoterHolding !== null ? new Prisma.Decimal(dto.preIpoPromoterHolding) : null } : {}),
        ...(dto.postIpoPromoterHolding !== undefined ? { postIpoPromoterHolding: dto.postIpoPromoterHolding !== null ? new Prisma.Decimal(dto.postIpoPromoterHolding) : null } : {}),
        ...(dto.preIpoMarketCap !== undefined ? { preIpoMarketCap: dto.preIpoMarketCap !== null ? new Prisma.Decimal(dto.preIpoMarketCap) : null } : {}),
        ...(dto.postIpoMarketCap !== undefined ? { postIpoMarketCap: dto.postIpoMarketCap !== null ? new Prisma.Decimal(dto.postIpoMarketCap) : null } : {}),
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
      dto.allotmentDate !== undefined ||
      dto.refundDate !== undefined
    ) {
      await this.updateLifecycleEvents(id, {
        openDate: dto.openDate,
        closeDate: dto.closeDate,
        listingDate: dto.listingDate,
        allotmentDate: dto.allotmentDate,
        refundDate: dto.refundDate,
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
    await this.saveDocuments(id, dto);

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
    const refundEvent = ipo.lifecycleEvents.find(
      (e) => e.eventType === 'REFUND_INITIATION',
    );

    const provenances = await this.prisma.fieldProvenance.findMany({
      where: {
        OR: [
          { entityType: 'IPO', entityId: ipo.id },
          { entityType: 'COMPANY', entityId: ipo.companyId },
        ],
      },
      include: { source: true },
      orderBy: { retrievedAt: 'desc' },
    });

    const anchorDoc = (ipo.documents ?? []).find((d) => d.documentType === 'ANCHOR_LIST');
    const anchorExt = (anchorDoc?.extractionData as any) || {};
    const anchorInvestors = Array.isArray(anchorExt.anchorInvestors) ? anchorExt.anchorInvestors : [];

    const resultDto = {
      id: ipo.id,
      companyId: ipo.companyId,
      legalName: ipo.company.legalName,
      displayName: ipo.company.displayName,
      cin: ipo.company.cin,
      logoUrl: ipo.company.logoUrl,
      website: ipo.company.website,
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
      listingPrice: ipo.listingPrice ? Number(ipo.listingPrice) : null,
      listingGainPct: ipo.listingGainPct ? Number(ipo.listingGainPct) : null,
      profitAmount: ipo.profitAmount ? Number(ipo.profitAmount) : null,
      profitPercentage: ipo.profitPercentage ? Number(ipo.profitPercentage) : null,
      preIpoEps: ipo.preIpoEps ? Number(ipo.preIpoEps) : null,
      postIpoEps: ipo.postIpoEps ? Number(ipo.postIpoEps) : null,
      preIpoPe: ipo.preIpoPe ? Number(ipo.preIpoPe) : null,
      postIpoPe: ipo.postIpoPe ? Number(ipo.postIpoPe) : null,
      preIpoPromoterHolding: ipo.preIpoPromoterHolding ? Number(ipo.preIpoPromoterHolding) : null,
      postIpoPromoterHolding: ipo.postIpoPromoterHolding ? Number(ipo.postIpoPromoterHolding) : null,
      preIpoMarketCap: ipo.preIpoMarketCap ? Number(ipo.preIpoMarketCap) : null,
      postIpoMarketCap: ipo.postIpoMarketCap ? Number(ipo.postIpoMarketCap) : null,
      marketCap: ipo.postIpoMarketCap ? Number(ipo.postIpoMarketCap) : (ipo.preIpoMarketCap ? Number(ipo.preIpoMarketCap) : null),
      openDate: openEvent ? openEvent.eventDate.toISOString().slice(0, 10) : null,
      closeDate: closeEvent ? closeEvent.eventDate.toISOString().slice(0, 10) : null,
      listingDate: listingEvent
        ? listingEvent.eventDate.toISOString().slice(0, 10)
        : null,
      allotmentDate: allotmentEvent
        ? allotmentEvent.eventDate.toISOString().slice(0, 10)
        : null,
      refundDate: refundEvent
        ? refundEvent.eventDate.toISOString().slice(0, 10)
        : null,
      anchorInvestors,
      documents: ipo.documents ?? [],
      allotmentConfig: ipo.allotmentConfig,
      offerCategories: ipo.offerCategories,
      financials: ipo.company.financials,
      participants: ipo.participants,
      gmpObservations: ipo.gmpObservations,
      latestGmp: ipo.gmpObservations?.[0]
        ? {
            gmpAmount: ipo.gmpObservations[0].gmpAmount ? Number(ipo.gmpObservations[0].gmpAmount) : null,
            gmpPercentage: ipo.gmpObservations[0].gmpPercentage ? Number(ipo.gmpObservations[0].gmpPercentage) : null,
            estProfitPerLot: ipo.gmpObservations[0].estProfitPerLot ? Number(ipo.gmpObservations[0].estProfitPerLot) : null,
            observedAt: ipo.gmpObservations[0].observedAt.toISOString(),
          }
        : null,
      currentGmp: ipo.gmpObservations?.[0]
        ? {
            gmpAmount: ipo.gmpObservations[0].gmpAmount ? Number(ipo.gmpObservations[0].gmpAmount) : null,
            gmpPercentage: ipo.gmpObservations[0].gmpPercentage ? Number(ipo.gmpObservations[0].gmpPercentage) : null,
            estProfitPerLot: ipo.gmpObservations[0].estProfitPerLot ? Number(ipo.gmpObservations[0].estProfitPerLot) : null,
            observedAt: ipo.gmpObservations[0].observedAt.toISOString(),
          }
        : null,
      gmpAmount: ipo.gmpObservations?.[0]?.gmpAmount ? Number(ipo.gmpObservations[0].gmpAmount) : null,
      gmpPercentage: ipo.gmpObservations?.[0]?.gmpPercentage ? Number(ipo.gmpObservations[0].gmpPercentage) : null,
      estProfitPerLot: ipo.gmpObservations?.[0]?.estProfitPerLot ? Number(ipo.gmpObservations[0].estProfitPerLot) : null,
      subscriptionObservations: ipo.subscriptionObservations,
      sourceIdentities: ipo.sourceIdentities,
      validation: this.validationService.validateIpo({
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
      }),
      createdAt: ipo.createdAt,
      updatedAt: ipo.updatedAt,
    };

    const fieldProvenanceMap = this.provenanceResolver.resolveAllFields(
      resultDto,
      provenances as any,
    );

    return {
      ...resultDto,
      fieldProvenanceMap,
      fieldProvenances: provenances,
    };
  }

  /**
   * Searchable Admin list query returning all IPOs (DRAFT, PUBLISHED, ARCHIVED).
   */
  async listIpos(query: AdminIpoQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 500) : 50;
    const skip = (page - 1) * limit;

    const baseSourceWhere: Prisma.IpoWhereInput = {
      sourceIdentities: {
        some: {
          source: {
            code: {
              in: ['ADMIN', 'IPOGURU'],
            },
          },
        },
      },
    };

    const where: Prisma.IpoWhereInput = {
      ...baseSourceWhere,
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

    if (query.status) {
      if (typeof query.status === 'string' && query.status.includes(',')) {
        const statuses = query.status.split(',').map((s) => {
          const trimmed = s.trim();
          return trimmed === 'ALLOTMENT_OUT' ? IpoStatus.ALLOTMENT_COMPLETED : (trimmed as IpoStatus);
        });
        where.status = { in: statuses };
      } else {
        const s = typeof query.status === 'string' ? query.status.trim() : query.status;
        if (s === 'CLOSED') {
          where.status = IpoStatus.CLOSED;
        } else if (s === 'ALLOTMENT_PENDING' || s === 'ALLOTMENT_AWAITED' || s === 'ALLOTMENT_AWAITING') {
          where.status = IpoStatus.ALLOTMENT_PENDING;
        } else if (s === 'LISTED') {
          where.status = { in: [IpoStatus.LISTED, IpoStatus.LISTING_PENDING] };
        } else if (s === 'OPEN') {
          where.status = { in: [IpoStatus.OPEN, IpoStatus.CLOSING_TODAY] };
        } else if (s === 'ALLOTMENT_OUT' || s === 'ALLOTMENT_COMPLETED') {
          where.status = IpoStatus.ALLOTMENT_COMPLETED;
        } else {
          where.status = s as IpoStatus;
        }
      }
    }
    if (query.publicationStatus) where.publicationStatus = query.publicationStatus;
    if (query.marketSegment) where.marketSegment = query.marketSegment;
    if (query.exchange) where.exchange = query.exchange;

    const [matchedIpos, allAdminIpos] = await Promise.all([
      this.prisma.ipo.findMany({
        where,
        include: {
          company: true,
          lifecycleEvents: true,
          allotmentConfig: true,
          gmpObservations: {
            orderBy: { observedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ipo.findMany({
        where: baseSourceWhere,
        select: {
          id: true,
          status: true,
          publicationStatus: true,
        },
      }),
    ]);

    const total = matchedIpos.length;

    // Smart status and lifecycle date sorting
    const sorted = this.sortAdminIpos(matchedIpos, query);
    const paginatedItems = sorted.slice(skip, skip + limit);

    // Compute status and publication tab breakdown counts
    const statusCounts: Record<string, number> = {
      ALL: allAdminIpos.length,
      OPEN: 0,
      UPCOMING: 0,
      CLOSED: 0,
      ALLOTMENT_PENDING: 0,
      ALLOTMENT_COMPLETED: 0,
      LISTED: 0,
      DRAFT: 0,
    };

    const publicationCounts: Record<string, number> = {
      ALL: allAdminIpos.length,
      PUBLISHED: 0,
      DRAFT: 0,
      ARCHIVED: 0,
    };

    for (const ipo of allAdminIpos) {
      if (ipo.status === 'OPEN' || ipo.status === 'CLOSING_TODAY') {
        statusCounts.OPEN = (statusCounts.OPEN || 0) + 1;
      }
      if (ipo.status === 'DRAFT') {
        statusCounts.DRAFT = (statusCounts.DRAFT || 0) + 1;
      }
      if (ipo.status === 'UPCOMING') {
        statusCounts.UPCOMING = (statusCounts.UPCOMING || 0) + 1;
      }
      if (ipo.status === 'CLOSED') {
        statusCounts.CLOSED = (statusCounts.CLOSED || 0) + 1;
      }
      if (ipo.status === 'ALLOTMENT_PENDING') {
        statusCounts.ALLOTMENT_PENDING = (statusCounts.ALLOTMENT_PENDING || 0) + 1;
      }
      if (ipo.status === 'ALLOTMENT_COMPLETED') {
        statusCounts.ALLOTMENT_COMPLETED = (statusCounts.ALLOTMENT_COMPLETED || 0) + 1;
      }
      if (ipo.status === 'LISTED' || ipo.status === 'LISTING_PENDING') {
        statusCounts.LISTED = (statusCounts.LISTED || 0) + 1;
      }

      if (ipo.publicationStatus === 'PUBLISHED') publicationCounts.PUBLISHED = (publicationCounts.PUBLISHED || 0) + 1;
      else if (ipo.publicationStatus === 'DRAFT') publicationCounts.DRAFT = (publicationCounts.DRAFT || 0) + 1;
      else if (ipo.publicationStatus === 'ARCHIVED') publicationCounts.ARCHIVED = (publicationCounts.ARCHIVED || 0) + 1;
    }

    return {
      items: paginatedItems.map((ipo) => {
        const openEv = ipo.lifecycleEvents?.find((e: any) => e.eventType === 'OPEN');
        const closeEv = ipo.lifecycleEvents?.find((e: any) => e.eventType === 'CLOSE');
        const listingEv = ipo.lifecycleEvents?.find((e: any) => e.eventType === 'LISTING');
        const allotmentEv = ipo.lifecycleEvents?.find((e: any) => e.eventType === 'BASIS_OF_ALLOTMENT');
        const effectiveAllotmentDate = allotmentEv
          ? allotmentEv.eventDate.toISOString().slice(0, 10)
          : (ipo.allotmentConfig?.expectedAllotmentDate
              ? (ipo.allotmentConfig.expectedAllotmentDate instanceof Date
                  ? ipo.allotmentConfig.expectedAllotmentDate.toISOString().slice(0, 10)
                  : String(ipo.allotmentConfig.expectedAllotmentDate).slice(0, 10))
              : null);
        const latestGmpObs = ipo.gmpObservations?.[0];
        const latestGmp = latestGmpObs
          ? {
              gmpAmount: latestGmpObs.gmpAmount ? Number(latestGmpObs.gmpAmount) : null,
              gmpPercentage: latestGmpObs.gmpPercentage ? Number(latestGmpObs.gmpPercentage) : null,
              estProfitPerLot: latestGmpObs.estProfitPerLot ? Number(latestGmpObs.estProfitPerLot) : null,
              observedAt: latestGmpObs.observedAt.toISOString(),
            }
          : null;

        return {
          id: ipo.id,
          legalName: ipo.company?.legalName || '',
          displayName: ipo.company?.displayName || ipo.company?.legalName || '',
          symbol: ipo.symbol,
          marketSegment: ipo.marketSegment,
          exchange: ipo.exchange,
          status: ipo.status,
          publicationStatus: ipo.publicationStatus,
          priceBandLow: ipo.priceBandLow ? Number(ipo.priceBandLow) : null,
          priceBandHigh: ipo.priceBandHigh ? Number(ipo.priceBandHigh) : null,
          lotSize: ipo.lotSize,
          listingPrice: ipo.listingPrice ? Number(ipo.listingPrice) : null,
          listingGainPct: ipo.listingGainPct ? Number(ipo.listingGainPct) : null,
          profitAmount: ipo.profitAmount ? Number(ipo.profitAmount) : null,
          profitPercentage: ipo.profitPercentage ? Number(ipo.profitPercentage) : null,
          openDate: openEv ? openEv.eventDate.toISOString().slice(0, 10) : null,
          closeDate: closeEv ? closeEv.eventDate.toISOString().slice(0, 10) : null,
          listingDate: listingEv ? listingEv.eventDate.toISOString().slice(0, 10) : null,
          allotmentDate: effectiveAllotmentDate,
          allotment_date: effectiveAllotmentDate,
          latestGmp,
          currentGmp: latestGmp,
          gmpAmount: latestGmpObs?.gmpAmount ? Number(latestGmpObs.gmpAmount) : null,
          gmpPercentage: latestGmpObs?.gmpPercentage ? Number(latestGmpObs.gmpPercentage) : null,
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
      counts: {
        statuses: statusCounts,
        publication: publicationCounts,
      },
    };
  }

  private sortAdminIpos(items: any[], query: AdminIpoQueryDto): any[] {
    const extractDate = (ipo: any, eventType: string): Date | null => {
      if (!ipo || !ipo.lifecycleEvents) return null;
      const ev = ipo.lifecycleEvents.find((e: any) => e.eventType === eventType);
      if (!ev || !ev.eventDate) return null;
      return ev.eventDate instanceof Date ? ev.eventDate : new Date(ev.eventDate);
    };

    const extractAllotmentDate = (ipo: any): Date | null => {
      if (ipo?.allotmentResultAvailableAt) {
        return ipo.allotmentResultAvailableAt instanceof Date
          ? ipo.allotmentResultAvailableAt
          : new Date(ipo.allotmentResultAvailableAt);
      }
      return extractDate(ipo, 'BASIS_OF_ALLOTMENT') || extractDate(ipo, 'ALLOTMENT');
    };

    const extractGmpPercentage = (ipo: any): number | null => {
      if (ipo.gmpObservations && ipo.gmpObservations.length > 0) {
        const obs = ipo.gmpObservations[0];
        if (obs.gmpPercentage !== null && obs.gmpPercentage !== undefined) {
          const val = Number(obs.gmpPercentage);
          if (!isNaN(val) && val > 0) return val;
        }
        if (obs.gmpAmount !== null && obs.gmpAmount !== undefined && Number(obs.gmpAmount) > 0) {
          const price = ipo.priceBandHigh ? Number(ipo.priceBandHigh) : (ipo.priceBandLow ? Number(ipo.priceBandLow) : 0);
          if (price > 0) return (Number(obs.gmpAmount) / price) * 100;
        }
      }
      if (ipo.gmpPercentage !== undefined && ipo.gmpPercentage !== null && Number(ipo.gmpPercentage) > 0) {
        return Number(ipo.gmpPercentage);
      }
      if (ipo.gmpAmount !== undefined && ipo.gmpAmount !== null && Number(ipo.gmpAmount) > 0) {
        const price = ipo.priceBandHigh ? Number(ipo.priceBandHigh) : (ipo.priceBandLow ? Number(ipo.priceBandLow) : 0);
        if (price > 0) return (Number(ipo.gmpAmount) / price) * 100;
      }
      return null;
    };

    const sort = query.sort;
    const order = query.order ?? (sort === 'companyName' || sort === 'legalName' || sort === 'openDate' || sort === 'closeDate' ? 'asc' : 'desc');

    if (sort && sort !== 'smart') {
      return [...items].sort((a, b) => {
        let diff = 0;
        if (sort === 'closeDate') {
          const dA = extractDate(a, 'CLOSE');
          const dB = extractDate(b, 'CLOSE');
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'openDate') {
          const dA = extractDate(a, 'OPEN');
          const dB = extractDate(b, 'OPEN');
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'listingDate') {
          const dA = extractDate(a, 'LISTING');
          const dB = extractDate(b, 'LISTING');
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'allotmentDate') {
          const dA = extractAllotmentDate(a);
          const dB = extractAllotmentDate(b);
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'gmp') {
          const gA = extractGmpPercentage(a);
          const gB = extractGmpPercentage(b);
          if (gA !== null && gB !== null) diff = gA - gB;
          else if (gA !== null) return -1;
          else if (gB !== null) return 1;
        } else if (sort === 'companyName' || sort === 'legalName') {
          const nA = (a.company?.displayName || a.company?.legalName || '').toLowerCase();
          const nB = (b.company?.displayName || b.company?.legalName || '').toLowerCase();
          diff = nA.localeCompare(nB);
        } else if (sort === 'issueSize') {
          const sA = a.issueSize ? Number(a.issueSize) : null;
          const sB = b.issueSize ? Number(b.issueSize) : null;
          if (sA !== null && sB !== null) diff = sA - sB;
          else if (sA !== null) return -1;
          else if (sB !== null) return 1;
        } else if (sort === 'updatedAt') {
          diff = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        } else {
          diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }

        return order === 'asc' ? diff : -diff;
      });
    }

    // Default Smart status-aware sorting:
    return [...items].sort((a, b) => {
      const getStatusRank = (st: string) => {
        switch (st) {
          case 'CLOSING_TODAY': return 1;
          case 'OPEN': return 2;
          case 'UPCOMING': return 3;
          case 'CLOSED':
          case 'ALLOTMENT_PENDING': return 4;
          case 'ALLOTMENT_COMPLETED': return 5;
          case 'LISTING_PENDING':
          case 'LISTED': return 6;
          default: return 7;
        }
      };

      const rankA = getStatusRank(a.status);
      const rankB = getStatusRank(b.status);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      if (a.status === 'OPEN' || a.status === 'CLOSING_TODAY') {
        // Closing soon comes on top (ASC closeDate)
        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cA.getTime() - cB.getTime();
          if (diff !== 0) return diff;
        } else if (cA) return -1;
        else if (cB) return 1;

        const oA = extractDate(a, 'OPEN');
        const oB = extractDate(b, 'OPEN');
        if (oA && oB) {
          const diff = oA.getTime() - oB.getTime();
          if (diff !== 0) return diff;
        }
      } else if (a.status === 'UPCOMING') {
        // Opening / closing soon comes on top (ASC openDate, then ASC closeDate)
        const oA = extractDate(a, 'OPEN');
        const oB = extractDate(b, 'OPEN');
        if (oA && oB) {
          const diff = oA.getTime() - oB.getTime();
          if (diff !== 0) return diff;
        } else if (oA) return -1;
        else if (oB) return 1;

        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cA.getTime() - cB.getTime();
          if (diff !== 0) return diff;
        }
      } else if (a.status === 'CLOSED' || a.status === 'ALLOTMENT_PENDING') {
        // Closed recently comes on top (DESC closeDate)
        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cB.getTime() - cA.getTime();
          if (diff !== 0) return diff;
        } else if (cA) return -1;
        else if (cB) return 1;
      } else if (a.status === 'ALLOTMENT_COMPLETED') {
        // Allotment out recently comes on top (DESC allotmentDate)
        const alA = extractAllotmentDate(a);
        const alB = extractAllotmentDate(b);
        if (alA && alB) {
          const diff = alB.getTime() - alA.getTime();
          if (diff !== 0) return diff;
        } else if (alA) return -1;
        else if (alB) return 1;

        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cB.getTime() - cA.getTime();
          if (diff !== 0) return diff;
        }
      } else if (a.status === 'LISTED' || a.status === 'LISTING_PENDING') {
        // Listed recently comes on top (DESC listingDate)
        const lA = extractDate(a, 'LISTING');
        const lB = extractDate(b, 'LISTING');
        if (lA && lB) {
          const diff = lB.getTime() - lA.getTime();
          if (diff !== 0) return diff;
        } else if (lA) return -1;
        else if (lB) return 1;
      }

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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
   * Manually executes missing-field AI enrichment for an IPO.
   * Reuses the single authoritative EnrichmentOrchestratorService pipeline.
   * Never overwrites existing verified fields.
   */
  async enrichIpoWithAi(
    ipoId: string,
    forceRefresh = false,
  ): Promise<{
    result: EnrichmentJobResult;
    researchSummary?: IpoReconciliationSummary;
    updatedIpo?: any;
  }> {
    const existing = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
      include: { company: true },
    });
    if (!existing) {
      throw new NotFoundException(`IPO with ID '${ipoId}' not found.`);
    }

    if (this.aiResearchOrchestrator) {
      const researchSummary = await this.aiResearchOrchestrator.executeResearchNow(ipoId, {
        forceRefresh,
      });

      const updatedIpo = await this.getIpoDetail(ipoId);

      const result: EnrichmentJobResult = {
        ipoId,
        status: researchSummary.appliedCount > 0 ? 'COMPLETED' : 'SKIPPED',
        missingFieldsDetected: researchSummary.decisions.map((d) => d.fieldKey as any),
        enrichedFields: researchSummary.decisions.filter((d) => d.applied).map((d) => d.fieldKey),
        skippedFields: researchSummary.decisions.filter((d) => !d.applied).map((d) => d.fieldKey),
        startedAt: researchSummary.evaluatedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };

      return {
        result,
        researchSummary,
        updatedIpo,
      };
    }

    if (!this.enrichmentOrchestrator) {
      throw new BadRequestException('Enrichment orchestrator service is not available.');
    }

    const result = await this.enrichmentOrchestrator.processIpoEnrichment(ipoId, {
      forceRefresh,
    });

    const updatedIpo = await this.getIpoDetail(ipoId);

    return {
      result,
      updatedIpo,
    };
  }

  /**
   * Starts an asynchronous background AI research & update job for an IPO.
   */
  async startResearchJob(
    ipoId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<ResearchJob> {
    if (!this.aiResearchOrchestrator) {
      throw new BadRequestException('AI Research orchestrator service is not available.');
    }
    return this.aiResearchOrchestrator.startResearchJob(ipoId, options);
  }

  /**
   * Retrieves an in-flight or completed AI research job.
   */
  getResearchJob(jobId: string): ResearchJob | null {
    if (!this.aiResearchOrchestrator) {
      throw new BadRequestException('AI Research orchestrator service is not available.');
    }
    return this.aiResearchOrchestrator.getJob(jobId);
  }

  /**
   * Batch enqueues AI research for multiple IPOs with bounded concurrency.
   */
  async batchResearchIpos(
    ipoIds: string[],
    options?: { forceRefresh?: boolean },
  ): Promise<ResearchJob[]> {
    if (!this.aiResearchOrchestrator) {
      throw new BadRequestException('AI Research orchestrator service is not available.');
    }
    return this.aiResearchOrchestrator.batchResearchIpos(ipoIds, options);
  }

  /**
   * Bulk update Lifecycle Status for multiple IPOs.
   */
  async bulkUpdateStatus(ids: string[], status: IpoStatus) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('At least one IPO ID must be provided.');
    }
    if (!status || !Object.values(IpoStatus).includes(status)) {
      throw new BadRequestException(`Invalid lifecycle status: ${status}`);
    }

    const updated = await this.prisma.ipo.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    for (const id of ids) {
      try {
        await this.ensureAdminSourceIdentity(id);
      } catch {}
    }

    return {
      count: updated.count,
      status,
      message: `Successfully updated lifecycle status to ${status} for ${updated.count} IPO(s).`,
    };
  }

  /**
   * Bulk publish multiple IPOs (validates each IPO first).
   */
  async bulkPublish(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('At least one IPO ID must be provided.');
    }

    const publishedIds: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      try {
        const detail = await this.getIpoDetail(id);
        if (!detail.validation.isValid) {
          failed.push({
            id,
            reason: detail.validation.errors.join(', ') || 'Validation failed',
          });
          continue;
        }

        const updated = await this.prisma.ipo.update({
          where: { id },
          data: { publicationStatus: PublicationStatus.PUBLISHED },
        });
        await this.ensureAdminSourceIdentity(id, updated.symbol);
        publishedIds.push(id);
      } catch (err: any) {
        failed.push({
          id,
          reason: err.message || 'Failed to publish IPO',
        });
      }
    }

    return {
      count: publishedIds.length,
      publishedIds,
      failedCount: failed.length,
      failed,
      message: `Published ${publishedIds.length} IPO(s).${failed.length > 0 ? ` ${failed.length} IPO(s) failed validation.` : ''}`,
    };
  }

  /**
   * Bulk unpublish multiple IPOs (sets publicationStatus to DRAFT).
   */
  async bulkUnpublish(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('At least one IPO ID must be provided.');
    }

    const updated = await this.prisma.ipo.updateMany({
      where: { id: { in: ids } },
      data: { publicationStatus: PublicationStatus.DRAFT },
    });

    for (const id of ids) {
      try {
        await this.ensureAdminSourceIdentity(id);
      } catch {}
    }

    return {
      count: updated.count,
      message: `Successfully unpublished ${updated.count} IPO(s) (reverted to DRAFT).`,
    };
  }

  /**
   * Bulk archive multiple IPOs (sets publicationStatus to ARCHIVED).
   */
  async bulkArchive(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('At least one IPO ID must be provided.');
    }

    const updated = await this.prisma.ipo.updateMany({
      where: { id: { in: ids } },
      data: { publicationStatus: PublicationStatus.ARCHIVED },
    });

    for (const id of ids) {
      try {
        await this.ensureAdminSourceIdentity(id);
      } catch {}
    }

    return {
      count: updated.count,
      message: `Successfully archived ${updated.count} IPO(s).`,
    };
  }

  /**
   * Bulk delete multiple IPOs with cascading child cleanup.
   */
  async bulkDelete(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('At least one IPO ID must be provided.');
    }

    const deletedIds: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      try {
        await this.deleteIpo(id);
        deletedIds.push(id);
      } catch (err: any) {
        failed.push({
          id,
          reason: err.message || 'Failed to delete IPO',
        });
      }
    }

    return {
      count: deletedIds.length,
      deletedIds,
      failedCount: failed.length,
      failed,
      message: `Successfully deleted ${deletedIds.length} IPO(s).${failed.length > 0 ? ` ${failed.length} failed.` : ''}`,
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

    const norm = this.normalizeIncomingAddOnlyItem(payload);
    const companyData = norm.rawCompany;
    const ipoData = norm.rawIpo;

    // 1. Mandatory Identity & Enums
    const legalName = (
      norm.legalName ||
      norm.displayName ||
      companyData.legalName ||
      companyData.displayName ||
      companyData.companyName ||
      payload.companyName
    )?.trim();
    if (!legalName) {
      throw new BadRequestException('Company name (legalName or companyName) is required in JSON payload');
    }

    // Exchange Normalization
    const exchange: ExchangeListing =
      norm.exchange ||
      this.normalizeExchangeListing(payload.exchange || ipoData.exchange || companyData.exchange) ||
      ExchangeListing.NSE;

    // Market Segment / Issue Type Normalization
    const marketSegment: MarketSegment =
      norm.marketSegment ||
      this.normalizeMarketSegment(payload.issueType || ipoData.issueType || ipoData.marketSegment || companyData.marketSegment) ||
      MarketSegment.MAINBOARD;

    let status: IpoStatus = IpoStatus.DRAFT;
    const rawStatus = String(ipoData.status || payload.status || 'DRAFT').trim().toUpperCase();
    if (Object.values(IpoStatus).includes(rawStatus as any)) {
      status = rawStatus as IpoStatus;
    }

    const topLevelKeys = Object.keys(payload || {});
    const rawOfferCategories = payload.offerCategories || ipoData.offerCategories || [];
    const rawSubItems = Array.isArray(payload.subscription)
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
    const rawDocList = Array.isArray(payload.documents) ? payload.documents : [];

    this.logger.log({
      context: 'Manual IPO JSON Import',
      topLevelKeys,
      legalName,
      marketSegment,
      exchange,
      status,
      offerCategories: rawOfferCategories.map((c: any) => c.category || c.categoryCode),
      subscriptionCategories: rawSubItems.map((s: any) => s.category || s.categoryCode),
      documentTypes: [
        ...(payload.drhpUrl || ipoData.drhpUrl ? ['DRHP'] : []),
        ...(payload.rhpUrl || ipoData.rhpUrl ? ['RHP'] : []),
        ...rawDocList.map((d: any) => d.documentType || d.type),
      ],
      mappedPrismaEnums: {
        marketSegment,
        exchange,
        status,
      },
    });

    // 2. Validate Price Band
    const priceBandLowVal = ipoData.priceBandLow ?? ipoData.priceBandMin ?? payload.priceBandMin;
    const priceBandHighVal = ipoData.priceBandHigh ?? ipoData.priceBandMax ?? payload.priceBandMax;

    if (
      priceBandLowVal !== undefined &&
      priceBandLowVal !== null &&
      priceBandHighVal !== undefined &&
      priceBandHighVal !== null
    ) {
      const decLow = new Prisma.Decimal(priceBandLowVal);
      const decHigh = new Prisma.Decimal(priceBandHighVal);
      if (decLow.gt(decHigh)) {
        throw new BadRequestException(
          `priceBandLow/Min (${priceBandLowVal}) cannot be greater than priceBandHigh/Max (${priceBandHighVal})`,
        );
      }
    }

    // 3. Validate Monetary Sizes & Share Counts consistency (Decimal-safe)
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
      const decIssueSize = new Prisma.Decimal(issueSizeVal);
      const decFreshIssueSize = new Prisma.Decimal(freshIssueSizeVal);
      const decOfsSize = new Prisma.Decimal(ofsSizeVal);
      const minRequiredIssueSize = decFreshIssueSize.plus(decOfsSize);

      if (decIssueSize.lt(minRequiredIssueSize)) {
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
      const decIssueShares = new Prisma.Decimal(issueShareCountVal);
      const decFreshShares = new Prisma.Decimal(freshIssueShareCountVal);
      const decOfsShares = new Prisma.Decimal(ofsShareCountVal);
      const minRequiredShares = decFreshShares.plus(decOfsShares);

      if (decIssueShares.lt(minRequiredShares)) {
        throw new BadRequestException(
          'issueShareCount cannot be less than the sum of freshIssueShareCount and ofsShareCount',
        );
      }
    }

    // 4. Validate Dates
    const parseDateStr = (dateStr?: string | null): Date | null => {
      if (!dateStr || this.isPlaceholderOrNil(dateStr)) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid date string: ${dateStr}`);
      }
      return d;
    };

    const openDate = parseDateStr(norm.rawTimeline.openDate || payload.openDate || ipoData.openDate);
    const closeDate = parseDateStr(norm.rawTimeline.closeDate || payload.closeDate || ipoData.closeDate);
    const listingDate = parseDateStr(norm.rawTimeline.listingDate || payload.listingDate || ipoData.listingDate);

    if (openDate && closeDate && openDate > closeDate) {
      throw new BadRequestException('openDate cannot be after closeDate');
    }
    if (openDate && listingDate && openDate > listingDate) {
      throw new BadRequestException('openDate cannot be after listingDate');
    }

    // 5. Target IPO Safety Overwrite Check
    const resolvedTargetIpoId = (targetIpoId || payload?.targetIpoId || payload?.id || payload?.ipoId || norm.rawIpo.id || norm.rawIpo.targetIpoId)?.trim?.();
    let existingIpo: any = null;
    if (resolvedTargetIpoId) {
      existingIpo = await this.prisma.ipo.findUnique({
        where: { id: resolvedTargetIpoId },
        include: { company: true },
      });
      if (!existingIpo) {
        throw new NotFoundException(`Target IPO ${resolvedTargetIpoId} not found`);
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
      const companiesByCin = cin
        ? await this.prisma.company.findMany({
            where: { cin: { equals: cin, mode: 'insensitive' } },
          })
        : [];
      if (companiesByCin.length > 1) {
        throw new BadRequestException(
          `Ambiguous company match: multiple existing companies match CIN '${cin}'.`,
        );
      }
      const companyByCin = companiesByCin[0] || null;

      const companiesByName = await this.prisma.company.findMany({
        where: { legalName: { equals: legalName, mode: 'insensitive' } },
      });

      if (companiesByName.length > 1) {
        throw new BadRequestException(
          `Ambiguous company match: multiple existing companies match Legal Name '${legalName}'.`,
        );
      }
      const companyByName = companiesByName[0] || null;

      if (companyByCin && companyByName && companyByCin.id !== companyByName.id) {
        throw new BadRequestException(
          `Ambiguous company match: CIN '${cin}' and Legal Name '${legalName}' match different existing companies.`,
        );
      }
      if (cin && companyByName && companyByName.cin && companyByName.cin !== cin) {
        throw new BadRequestException(
          `Ambiguous company match: existing company with Legal Name '${legalName}' has CIN '${companyByName.cin}', which conflicts with supplied CIN '${cin}'.`,
        );
      }

      company = companyByCin || companyByName;
    }

    // 7. Atomic Transactional Add-Only Pipeline
    const adminSourceId = await this.getAdminSourceId();

    try {
      const createdOrUpdatedIpo = await this.prisma.$transaction(async (tx) => {
        if (existingIpo) {
          await this.executeAddOnlyTransactionForIpo(
            tx,
            existingIpo.id,
            payload,
            adminSourceId,
          );
          return existingIpo;
        }

        if (!company) {
          company = await tx.company.create({
            data: {
              legalName,
              displayName: companyData.displayName?.trim() || legalName,
              cin,
            },
          });
        } else {
          company = await tx.company.update({
            where: { id: company.id },
            data: {
              legalName,
              displayName: companyData.displayName?.trim() || company.displayName || legalName,
              cin: cin || company.cin,
            },
          });
        }

        const ipo = await tx.ipo.create({
          data: {
            companyId: company.id,
            symbol: (ipoData.symbol || payload.symbol)?.trim() || null,
            isin: (ipoData.isin || payload.isin)?.trim() || null,
            nseSymbol: (ipoData.nseSymbol || payload.nseSymbol)?.trim() || null,
            bseSymbol: (ipoData.bseSymbol || payload.bseSymbol)?.trim() || null,
            exchange,
            marketSegment,
            status,
            publicationStatus: PublicationStatus.DRAFT,
            priceBandLow: (norm.rawCanonical.priceBandLow ?? norm.rawIpo.priceBandLow ?? norm.rawIpo.floorPrice ?? norm.rawIpo.priceBandMin ?? payload.priceBandLow ?? payload.priceBandMin ?? payload.floorPrice) ?? null,
            priceBandHigh: (norm.rawCanonical.priceBandHigh ?? norm.rawIpo.priceBandHigh ?? norm.rawIpo.capPrice ?? norm.rawIpo.priceBandMax ?? payload.priceBandHigh ?? payload.priceBandMax ?? payload.capPrice) ?? null,
            faceValue: (norm.rawCanonical.faceValue ?? norm.rawIpo.faceValue ?? payload.faceValue) ?? null,
            lotSize: (norm.rawCanonical.lotSize ?? norm.rawIpo.lotSize ?? norm.rawIpo.marketLot ?? payload.lotSize ?? payload.marketLot) ?? null,
            minimumLots: (norm.rawCanonical.minimumLots ?? norm.rawIpo.minimumLots ?? payload.minimumLots) ?? null,
            issueSize: (norm.rawCanonical.totalIssueSize ?? norm.rawCanonical.issueSize ?? norm.rawIpo.totalIssueSize ?? norm.rawIpo.issueSize ?? payload.totalIssueSize ?? payload.issueSize) ?? null,
            freshIssueSize: (norm.rawCanonical.freshIssueSize ?? norm.rawIpo.freshIssueSize ?? payload.freshIssueSize) ?? null,
            ofsSize: (norm.rawCanonical.offerForSaleSize ?? norm.rawCanonical.ofsSize ?? norm.rawIpo.ofsSize ?? payload.ofsSize) ?? null,
            issueShareCount: (norm.rawCanonical.totalShares ?? norm.rawCanonical.issueShareCount ?? norm.rawIpo.totalShares ?? norm.rawIpo.issueShareCount ?? payload.totalShares ?? payload.issueShareCount ?? payload.totalIssueShares) ?? null,
            freshIssueShareCount: (norm.rawCanonical.freshIssueShareCount ?? norm.rawIpo.freshIssueShareCount ?? payload.freshIssueShareCount ?? payload.freshIssueShares) ?? null,
            ofsShareCount: (norm.rawCanonical.ofsShareCount ?? norm.rawIpo.ofsShareCount ?? payload.ofsShareCount ?? payload.ofsShares) ?? null,
            listingPrice: (norm.rawCanonical.listingPrice ?? norm.rawIpo.listingPrice ?? payload.listingPrice) ?? null,
            listingGainPct: (norm.rawCanonical.listingGainPct ?? norm.rawIpo.listingGainPct ?? payload.listingGainPct) ?? null,
            preIpoEps: (norm.rawValuation.preIpoEps ?? norm.rawIpo.preIpoEps ?? payload.preIpoEps) ?? null,
            postIpoEps: (norm.rawValuation.postIpoEps ?? norm.rawIpo.postIpoEps ?? payload.postIpoEps) ?? null,
            preIpoPe: (norm.rawValuation.preIpoPe ?? norm.rawIpo.preIpoPe ?? payload.preIpoPe) ?? null,
            postIpoPe: (norm.rawValuation.postIpoPe ?? norm.rawIpo.postIpoPe ?? payload.postIpoPe) ?? null,
            preIpoPromoterHolding: (norm.rawValuation.preIpoPromoterHolding ?? norm.rawIpo.preIpoPromoterHolding ?? payload.preIpoPromoterHolding) ?? null,
            postIpoPromoterHolding: (norm.rawValuation.postIpoPromoterHolding ?? norm.rawIpo.postIpoPromoterHolding ?? payload.postIpoPromoterHolding) ?? null,
            preIpoMarketCap: (norm.rawValuation.preIpoMarketCap ?? norm.rawIpo.preIpoMarketCap ?? payload.preIpoMarketCap) ?? null,
            postIpoMarketCap: (norm.rawValuation.postIpoMarketCap ?? norm.rawIpo.postIpoMarketCap ?? payload.postIpoMarketCap) ?? null,
          },
        });

        await this.executeAddOnlyTransactionForIpo(
          tx,
          ipo.id,
          payload,
          adminSourceId,
        );

        return ipo;
      });

      return {
        id: createdOrUpdatedIpo.id,
        publicationStatus: createdOrUpdatedIpo.publicationStatus,
        message: 'JSON import successful. IPO created/updated in DRAFT status.',
      };
    } catch (err: any) {
      this.logger.error({
        context: 'Manual IPO JSON Import Failure',
        message: err.message || 'Database error during manual IPO JSON import',
        stack: err.stack,
        statusCode: err.status || 400,
        prismaCode: err.code,
        prismaMeta: err.meta,
      });

      if (err instanceof HttpException) {
        throw err;
      }

      throw new BadRequestException({
        message: err.message ? `Manual IPO JSON import failed: ${err.message}` : 'Manual IPO JSON import failed',
        details: err.meta || err.message || 'Database transaction failed during import',
        prismaCode: err.code,
        prismaMeta: err.meta,
      });
    }
  }

  /**
   * Configures or updates registrar allotment checking settings for a published IPO.
   */
  async configureAllotment(ipoId: string, dto: ConfigureAllotmentDto) {
    const ipo = await this.prisma.ipo.findUnique({ where: { id: ipoId } });
    if (!ipo) {
      throw new NotFoundException(`IPO with ID '${ipoId}' not found`);
    }

    const rawRegistrar = dto.registrar || dto.registrarCode || '';
    const registrarVal = rawRegistrar.toLowerCase().trim();
    if (!registrarVal) {
      throw new BadRequestException('Registrar (registrar or registrarCode) is required');
    }

    const expectedDate = dto.expectedAllotmentDate
      ? new Date(dto.expectedAllotmentDate)
      : null;

    const config = await this.prisma.ipoAllotmentConfig.upsert({
      where: { ipoId },
      update: {
        registrar: registrarVal,
        registrarIpoCode: dto.registrarIpoCode?.trim() || null,
        allotmentSourceUrl: dto.allotmentSourceUrl?.trim() || null,
        expectedAllotmentDate: expectedDate,
        enabled: dto.enabled !== undefined ? dto.enabled : true,
      },
      create: {
        ipoId,
        registrar: registrarVal,
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
    dates: { openDate?: string; closeDate?: string; listingDate?: string; allotmentDate?: string; refundDate?: string },
  ) {
    const updates: Array<{ eventType: 'OPEN' | 'CLOSE' | 'LISTING' | 'BASIS_OF_ALLOTMENT' | 'REFUND_INITIATION'; dateStr?: string }> = [
      { eventType: 'OPEN', dateStr: dates.openDate },
      { eventType: 'CLOSE', dateStr: dates.closeDate },
      { eventType: 'LISTING', dateStr: dates.listingDate },
      { eventType: 'BASIS_OF_ALLOTMENT', dateStr: dates.allotmentDate },
      { eventType: 'REFUND_INITIATION', dateStr: dates.refundDate },
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
          ebitdaMarginPercent: fin.ebitdaMarginPercent !== undefined && fin.ebitdaMarginPercent !== null ? new Prisma.Decimal(fin.ebitdaMarginPercent) : null,
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
    filledFields?: string[],
  ) {
    const now = new Date();
    const records: Array<{
      entityType: 'IPO' | 'COMPANY';
      entityId: string;
      fieldName: string;
      value: string;
    }> = [];

    const norm = this.normalizeIncomingAddOnlyItem(dto);

    // Company fields
    const legalNameVal = dto.legalName || norm.legalName;
    if (legalNameVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.legal_name', value: String(legalNameVal) });
    const displayNameVal = dto.displayName || norm.displayName;
    if (displayNameVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.display_name', value: String(displayNameVal) });
    const cinVal = dto.cin || norm.cin;
    if (cinVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.cin', value: String(cinVal) });
    const industryVal = dto.industry || norm.rawCompany?.industry;
    if (industryVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.industry', value: String(industryVal) });
    const sectorVal = dto.sector || norm.rawCompany?.sector;
    if (sectorVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.sector', value: String(sectorVal) });
    const aboutVal = dto.aboutDescription || norm.rawCompany?.aboutDescription || norm.rawIpo?.company?.aboutDescription;
    if (aboutVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.about_description', value: String(aboutVal) });
    const websiteVal = dto.website || norm.rawCompany?.website || norm.rawIpo?.company?.website;
    if (websiteVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.website', value: String(websiteVal) });
    const phoneVal = dto.phone || norm.rawCompany?.phone || norm.rawIpo?.company?.phone;
    if (phoneVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.phone', value: String(phoneVal) });
    const emailVal = dto.email || norm.rawCompany?.email || norm.rawIpo?.company?.email;
    if (emailVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.email', value: String(emailVal) });
    const contactVal = dto.contactPerson || norm.rawCompany?.contactPerson || norm.rawIpo?.company?.contactPerson;
    if (contactVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.contact_person', value: String(contactVal) });
    const logoVal = dto.logoUrl || norm.rawCompany?.logoUrl || norm.rawIpo?.company?.logoUrl;
    if (logoVal)
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.logo_url', value: String(logoVal) });

    // IPO fields
    const mktSegVal = dto.marketSegment || norm.marketSegment;
    if (mktSegVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'market_segment', value: String(mktSegVal) });
    const exchVal = dto.exchange || norm.exchange;
    if (exchVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'exchange', value: String(exchVal) });
    const statusVal = dto.status || norm.rawCanonical?.lifecycleStatus || norm.rawIpo?.status;
    if (statusVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'status', value: String(statusVal) });
    const pubStatusVal = dto.publicationStatus || norm.publicationStatus;
    if (pubStatusVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'publication_status', value: String(pubStatusVal) });
    const symbolVal = dto.symbol || norm.symbol;
    if (symbolVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'symbol', value: String(symbolVal) });
    const isinVal = dto.isin || norm.isin;
    if (isinVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'isin', value: String(isinVal) });

    const priceBandLowVal = dto.priceBandLow ?? norm.rawCanonical?.priceBandLow ?? norm.rawIpo?.priceBandLow ?? norm.rawIpo?.floorPrice;
    if (priceBandLowVal !== undefined && priceBandLowVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'price_band_low', value: String(priceBandLowVal) });
    const priceBandHighVal = dto.priceBandHigh ?? norm.rawCanonical?.priceBandHigh ?? norm.rawIpo?.priceBandHigh ?? norm.rawIpo?.capPrice;
    if (priceBandHighVal !== undefined && priceBandHighVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'price_band_high', value: String(priceBandHighVal) });
    const lotSizeVal = dto.lotSize ?? norm.rawCanonical?.lotSize ?? norm.rawIpo?.lotSize ?? norm.rawIpo?.marketLot;
    if (lotSizeVal !== undefined && lotSizeVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'lot_size', value: String(lotSizeVal) });
    const faceValueVal = dto.faceValue ?? norm.rawCanonical?.faceValue ?? norm.rawIpo?.faceValue;
    if (faceValueVal !== undefined && faceValueVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'face_value', value: String(faceValueVal) });
    const issueSizeVal = dto.issueSize ?? norm.rawCanonical?.totalIssueSize ?? norm.rawCanonical?.issueSize ?? norm.rawIpo?.totalIssueSize ?? norm.rawIpo?.issueSize ?? dto.totalIssueSize;
    if (issueSizeVal !== undefined && issueSizeVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'issue_size', value: String(issueSizeVal) });
    const freshIssueSizeVal = dto.freshIssueSize ?? norm.rawCanonical?.freshIssueSize ?? norm.rawIpo?.freshIssueSize;
    if (freshIssueSizeVal !== undefined && freshIssueSizeVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'fresh_issue_size', value: String(freshIssueSizeVal) });
    const ofsSizeVal = dto.ofsSize ?? norm.rawCanonical?.offerForSaleSize ?? norm.rawCanonical?.ofsSize ?? norm.rawIpo?.offerForSaleSize ?? norm.rawIpo?.ofsSize ?? dto.offerForSaleSize;
    if (ofsSizeVal !== undefined && ofsSizeVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'ofs_size', value: String(ofsSizeVal) });
    const issueShareCountVal = dto.issueShareCount ?? norm.rawCanonical?.totalShares ?? norm.rawCanonical?.issueShareCount;
    if (issueShareCountVal !== undefined && issueShareCountVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'issue_share_count', value: String(issueShareCountVal) });
    const freshIssueShareCountVal = dto.freshIssueShareCount ?? norm.rawCanonical?.freshIssueShareCount;
    if (freshIssueShareCountVal !== undefined && freshIssueShareCountVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'fresh_issue_share_count', value: String(freshIssueShareCountVal) });
    const ofsShareCountVal = dto.ofsShareCount ?? norm.rawCanonical?.ofsShareCount;
    if (ofsShareCountVal !== undefined && ofsShareCountVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'ofs_share_count', value: String(ofsShareCountVal) });
    const listingPriceVal = dto.listingPrice ?? norm.rawCanonical?.listingPrice;
    if (listingPriceVal !== undefined && listingPriceVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'listing_price', value: String(listingPriceVal) });
    const listingGainPctVal = dto.listingGainPct ?? norm.rawCanonical?.listingGainPct;
    if (listingGainPctVal !== undefined && listingGainPctVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'listing_gain_pct', value: String(listingGainPctVal) });
    const profitAmountVal = dto.profitAmount ?? norm.rawIpo?.profitAmount;
    if (profitAmountVal !== undefined && profitAmountVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'profit_amount', value: String(profitAmountVal) });
    const profitPercentageVal = dto.profitPercentage ?? norm.rawIpo?.profitPercentage;
    if (profitPercentageVal !== undefined && profitPercentageVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'profit_percentage', value: String(profitPercentageVal) });

    const preIpoEpsVal = dto.preIpoEps ?? norm.rawValuation?.preIpoEps;
    if (preIpoEpsVal !== undefined && preIpoEpsVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'pre_ipo_eps', value: String(preIpoEpsVal) });
    const postIpoEpsVal = dto.postIpoEps ?? norm.rawValuation?.postIpoEps;
    if (postIpoEpsVal !== undefined && postIpoEpsVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'post_ipo_eps', value: String(postIpoEpsVal) });
    const preIpoPeVal = dto.preIpoPe ?? norm.rawValuation?.preIpoPe;
    if (preIpoPeVal !== undefined && preIpoPeVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'pre_ipo_pe', value: String(preIpoPeVal) });
    const postIpoPeVal = dto.postIpoPe ?? norm.rawValuation?.postIpoPe;
    if (postIpoPeVal !== undefined && postIpoPeVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'post_ipo_pe', value: String(postIpoPeVal) });
    const preIpoPromoterHoldingVal = dto.preIpoPromoterHolding ?? norm.rawValuation?.preIpoPromoterHolding;
    if (preIpoPromoterHoldingVal !== undefined && preIpoPromoterHoldingVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'pre_ipo_promoter_holding', value: String(preIpoPromoterHoldingVal) });
    const postIpoPromoterHoldingVal = dto.postIpoPromoterHolding ?? norm.rawValuation?.postIpoPromoterHolding;
    if (postIpoPromoterHoldingVal !== undefined && postIpoPromoterHoldingVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'post_ipo_promoter_holding', value: String(postIpoPromoterHoldingVal) });
    const preIpoMarketCapVal = dto.preIpoMarketCap ?? norm.rawValuation?.preIpoMarketCap;
    if (preIpoMarketCapVal !== undefined && preIpoMarketCapVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'pre_ipo_market_cap', value: String(preIpoMarketCapVal) });
    const postIpoMarketCapVal = dto.postIpoMarketCap ?? norm.rawValuation?.postIpoMarketCap;
    if (postIpoMarketCapVal !== undefined && postIpoMarketCapVal !== null)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'post_ipo_market_cap', value: String(postIpoMarketCapVal) });

    const openDateVal = dto.openDate || norm.rawTimeline?.openDate || norm.rawTimeline?.issueOpenDate;
    if (openDateVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'open_date', value: String(openDateVal) });
    const closeDateVal = dto.closeDate || norm.rawTimeline?.closeDate || norm.rawTimeline?.issueCloseDate;
    if (closeDateVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'close_date', value: String(closeDateVal) });
    const allotmentDateVal = dto.allotmentDate || norm.rawTimeline?.allotmentDate || norm.rawTimeline?.basisOfAllotmentDate;
    if (allotmentDateVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'allotment_date', value: String(allotmentDateVal) });
    const refundProv =
      dto.refundDate ||
      dto.refundInitiationDate ||
      norm.rawTimeline?.refundInitiationDate ||
      norm.rawTimeline?.refundDate;
    if (refundProv)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'refund_date', value: String(refundProv) });
    const listingDateVal = dto.listingDate || norm.rawTimeline?.listingDate;
    if (listingDateVal)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'listing_date', value: String(listingDateVal) });
    const regNameProv =
      dto.registrarName ||
      norm.rawParticipants?.registrarName ||
      norm.rawParticipants?.name;
    if (regNameProv)
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'registrar_name', value: String(regNameProv) });

    let finalRecords = records;
    if (filledFields && Array.isArray(filledFields) && filledFields.length > 0) {
      const allowedSet = new Set<string>();
      for (const f of filledFields) {
        const lower = f.toLowerCase();
        allowedSet.add(f);
        allowedSet.add(lower);
        if (lower.includes('freshissuesize')) allowedSet.add('fresh_issue_size');
        if (lower.includes('ofssize')) allowedSet.add('ofs_size');
        if (lower.includes('issuesize')) allowedSet.add('issue_size');
        if (lower.includes('refund')) allowedSet.add('refund_date');
        if (lower.includes('open')) allowedSet.add('open_date');
        if (lower.includes('close')) allowedSet.add('close_date');
        if (lower.includes('allotment')) allowedSet.add('allotment_date');
        if (lower.includes('listingdate') || lower.includes('lifecycle.listing')) allowedSet.add('listing_date');
        if (lower.includes('pricebandlow')) allowedSet.add('price_band_low');
        if (lower.includes('pricebandhigh')) allowedSet.add('price_band_high');
        if (lower.includes('lotsize')) allowedSet.add('lot_size');
        if (lower.includes('facevalue')) allowedSet.add('face_value');
        if (lower.includes('registrar')) allowedSet.add('registrar_name');
        if (lower.startsWith('company.')) {
          allowedSet.add(lower);
          allowedSet.add(lower.replace('.', '_'));
          allowedSet.add(lower.replace('company.', ''));
        }
      }
      finalRecords = records.filter(
        (r) => allowedSet.has(r.fieldName) || allowedSet.has(r.fieldName.toLowerCase()),
      );
    }

    for (const r of finalRecords) {
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
   * Delete an IPO permanently with full transactional cascading and orphan company cleanup.
   */
  async deleteIpo(id: string) {
    const existing = await this.prisma.ipo.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!existing) {
      throw new NotFoundException(`IPO with ID ${id} not found.`);
    }

    const companyId = existing.companyId;

    await this.prisma.$transaction(async (tx) => {
      // 1. Delete all IPO-owned child records
      await tx.gmpObservation.deleteMany({ where: { ipoId: id } });
      await tx.subscriptionObservation.deleteMany({ where: { ipoId: id } });
      await tx.ipoLifecycleEvent.deleteMany({ where: { ipoId: id } });
      await tx.ipoOfferCategory.deleteMany({ where: { ipoId: id } });
      await tx.ipoParticipant.deleteMany({ where: { ipoId: id } });
      await tx.ipoSourceIdentity.deleteMany({ where: { ipoId: id } });
      await tx.ipoDocument.deleteMany({ where: { ipoId: id } });
      await tx.ipoAllotmentConfig.deleteMany({ where: { ipoId: id } });
      await tx.allotmentCheckLog.deleteMany({ where: { ipoId: id } });
      await tx.allotmentCheckJobItem.deleteMany({ where: { job: { ipoId: id } } });
      await tx.allotmentCheckJob.deleteMany({ where: { ipoId: id } });
      await tx.ipoChangeEvent.deleteMany({ where: { ipoId: id } });
      await tx.fieldProvenance.deleteMany({ where: { entityId: id, entityType: 'IPO' } });

      // 2. Delete the target IPO
      await tx.ipo.delete({ where: { id } });

      // 3. Check whether the company is referenced by any remaining IPOs
      if (companyId) {
        const remainingIposCount = await tx.ipo.count({
          where: { companyId },
        });

        // If no other IPO references this company, clean up company records and delete company
        if (remainingIposCount === 0) {
          await tx.companyFinancial.deleteMany({ where: { companyId } });
          await tx.fieldProvenance.deleteMany({ where: { entityId: companyId, entityType: 'COMPANY' } });
          await tx.company.delete({ where: { id: companyId } });
        }
      }
    });

    return { id, message: 'IPO and associated unshared records deleted permanently.' };
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

  private async saveDocuments(
    ipoId: string,
    dto: {
      drhpUrl?: string | null;
      rhpUrl?: string | null;
      prospectusUrl?: string | null;
      anchorListUrl?: string | null;
      anchorPortion?: number | null;
      anchorBidDate?: string | null;
      anchorLockIn?: string | null;
      anchorDetails?: string | null;
      anchorPrice?: number | null;
      anchorQibPct?: number | null;
      anchorLockIn30?: string | null;
      anchorLockIn90?: string | null;
      anchorInvestors?: Array<{
        anchorName: string;
        sharesAllotted?: number | null;
        amtCr?: number | null;
        pctAllocated?: number | null;
        pctOfIssue?: number | null;
      }> | null;
      documents?: Array<{
        id?: string | null;
        documentType?: DocumentType | string;
        fileName?: string | null;
        title?: string | null;
        sourceUrl?: string | null;
        url?: string | null;
      }> | null;
    },
  ) {
    const hasAnchorData =
      dto.anchorPortion !== undefined ||
      dto.anchorBidDate !== undefined ||
      dto.anchorLockIn !== undefined ||
      dto.anchorDetails !== undefined ||
      dto.anchorPrice !== undefined ||
      dto.anchorQibPct !== undefined ||
      dto.anchorLockIn30 !== undefined ||
      dto.anchorLockIn90 !== undefined ||
      dto.anchorInvestors !== undefined;

    const anchorData = hasAnchorData
      ? {
          anchorPortion: dto.anchorPortion ?? null,
          anchorBidDate: dto.anchorBidDate ?? null,
          anchorLockIn: dto.anchorLockIn ?? null,
          anchorDetails: dto.anchorDetails ?? null,
          anchorPrice: dto.anchorPrice ?? null,
          anchorQibPct: dto.anchorQibPct ?? null,
          anchorLockIn30: dto.anchorLockIn30 ?? null,
          anchorLockIn90: dto.anchorLockIn90 ?? null,
          anchorInvestors: dto.anchorInvestors ?? [],
        }
      : null;

    if (Array.isArray(dto.documents)) {
      const validIncomingDocs = dto.documents
        .map((d) => {
          const url = (d.sourceUrl || d.url || '').trim();
          const typeStr = (d.documentType || 'OTHER').toString().toUpperCase();
          let type: DocumentType = DocumentType.OTHER;
          if (typeStr.includes('DRHP')) type = DocumentType.DRHP;
          else if (typeStr.includes('RHP')) type = DocumentType.RHP;
          else if (typeStr.includes('PROSPECTUS')) type = DocumentType.PROSPECTUS;
          else if (typeStr.includes('ANCHOR')) type = DocumentType.ANCHOR_LIST;
          else if (typeStr.includes('BASIS')) type = DocumentType.BASIS_OF_ALLOTMENT;
          else if (Object.values(DocumentType).includes(typeStr as DocumentType)) {
            type = typeStr as DocumentType;
          }
          // Accept document if it has URL OR if it is ANCHOR_LIST
          if (!url && type !== DocumentType.ANCHOR_LIST) return null;
          return {
            id: (d.id || '').trim() || undefined,
            type,
            title: (d.fileName || d.title || '').trim() || null,
            url: url || null,
          };
        })
        .filter((d): d is { id: string | undefined; type: DocumentType; title: string | null; url: string | null } => d !== null);

      const existingDocs = await this.prisma.ipoDocument.findMany({
        where: { ipoId },
      });

      const processedIds = new Set<string>();

      for (const inDoc of validIncomingDocs) {
        let existing = inDoc.id
          ? existingDocs.find((e) => !processedIds.has(e.id) && e.id === inDoc.id)
          : undefined;

        if (!existing) {
          existing = existingDocs.find(
            (e) => !processedIds.has(e.id) && e.documentType === inDoc.type,
          );
        }

        const currentExtraction = (existing?.extractionData as object) || {};
        const extraction = inDoc.type === DocumentType.ANCHOR_LIST
          ? (anchorData !== null
              ? { ...currentExtraction, ...anchorData }
              : (existing?.extractionData ? currentExtraction : null))
          : existing?.extractionData;

        if (existing) {
          processedIds.add(existing.id);
          await this.prisma.ipoDocument.update({
            where: { id: existing.id },
            data: {
              documentType: inDoc.type,
              ...(inDoc.url ? { sourceUrl: inDoc.url } : {}),
              fileName: inDoc.title ?? existing.fileName,
              parsingStatus: 'PARSED',
              ...(extraction ? { extractionData: extraction as any } : {}),
            },
          });
        } else {
          const created = await this.prisma.ipoDocument.create({
            data: {
              ipoId,
              documentType: inDoc.type,
              sourceUrl: inDoc.url,
              fileName: inDoc.title ?? (inDoc.type === DocumentType.ANCHOR_LIST ? 'Anchor List' : null),
              source: 'MANUAL_UPLOAD',
              parsingStatus: 'PARSED',
              ...(extraction ? { extractionData: extraction as any } : {}),
            },
          });
          processedIds.add(created.id);
        }
      }

      // If anchorData was provided OR if an existing ANCHOR_LIST doc already exists with data, ensure it is preserved & updated
      const existingAnchor = existingDocs.find((e) => e.documentType === DocumentType.ANCHOR_LIST);
      if (existingAnchor && !processedIds.has(existingAnchor.id)) {
        const ext = (existingAnchor.extractionData as any) || {};
        const hasExistingData = (Array.isArray(ext.anchorInvestors) && ext.anchorInvestors.length > 0) || !!ext.anchorPortion || !!ext.anchorDetails;
        if (anchorData !== null || hasExistingData) {
          processedIds.add(existingAnchor.id);
          if (anchorData !== null) {
            const merged = { ...ext, ...anchorData };
            await this.prisma.ipoDocument.update({
              where: { id: existingAnchor.id },
              data: {
                extractionData: merged as any,
              },
            });
          }
        }
      } else if (!existingAnchor && anchorData !== null) {
        const createdAnchor = await this.prisma.ipoDocument.create({
          data: {
            ipoId,
            documentType: DocumentType.ANCHOR_LIST,
            fileName: 'Anchor List',
            sourceUrl: dto.anchorListUrl?.trim() || null,
            source: 'MANUAL_UPLOAD',
            parsingStatus: 'PARSED',
            extractionData: anchorData as any,
          },
        });
        processedIds.add(createdAnchor.id);
      }

      const toDelete = existingDocs.filter((e) => {
        if (processedIds.has(e.id)) return false;
        // Never delete an existing ANCHOR_LIST document if it has extractionData or anchor investors, unless explicitly cleared
        if (e.documentType === DocumentType.ANCHOR_LIST) {
          const ext = e.extractionData as any;
          if (ext && (ext.anchorInvestors?.length > 0 || ext.anchorPortion || ext.anchorDetails)) {
            return false;
          }
        }
        return true;
      });

      for (const delDoc of toDelete) {
        await this.prisma.ipoDocument.delete({ where: { id: delDoc.id } });
      }

      return;
    }

    const docs = [
      { type: DocumentType.DRHP, url: dto.drhpUrl, title: 'DRHP Prospectus' },
      { type: DocumentType.RHP, url: dto.rhpUrl, title: 'RHP Prospectus' },
      { type: DocumentType.PROSPECTUS, url: dto.prospectusUrl, title: 'Final Prospectus' },
      {
        type: DocumentType.ANCHOR_LIST,
        url: dto.anchorListUrl,
        title: 'Anchor List',
        extractionData: anchorData,
      },
    ];

    for (const doc of docs) {
      const hasUrl = doc.url !== undefined && doc.url !== null;
      const isAnchorWithData = doc.type === DocumentType.ANCHOR_LIST && anchorData !== null;

      if (hasUrl || isAnchorWithData) {
        const cleanUrl = doc.url?.trim() || null;
        const existing = await this.prisma.ipoDocument.findFirst({
          where: { ipoId, documentType: doc.type },
        });

        const currentExtraction = (existing?.extractionData as object) || {};
        const extraction = doc.extractionData
          ? { ...currentExtraction, ...doc.extractionData }
          : existing?.extractionData;

        if (cleanUrl || isAnchorWithData) {
          if (existing) {
            await this.prisma.ipoDocument.update({
              where: { id: existing.id },
              data: {
                ...(cleanUrl ? { sourceUrl: cleanUrl } : {}),
                fileName: doc.title,
                ...(extraction ? { extractionData: extraction as any } : {}),
              },
            });
          } else {
            await this.prisma.ipoDocument.create({
              data: {
                ipoId,
                documentType: doc.type,
                sourceUrl: cleanUrl,
                fileName: doc.title,
                source: 'MANUAL_UPLOAD',
                parsingStatus: 'PARSED',
                ...(extraction ? { extractionData: extraction as any } : {}),
              },
            });
          }
        }
      }
    }
  }

  // =========================================================================
  // ADD-ONLY JSON IMPORT: PREVIEW & COMMIT (MASTER JSON SUPPORT)
  // =========================================================================

  private normalizeJsonPayloadItems(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.payload)) return payload.payload;
    if (payload.payload && typeof payload.payload === 'object') return this.normalizeJsonPayloadItems(payload.payload);
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.ipos)) return payload.ipos;
    if (Array.isArray(payload.data)) return payload.data;
    if (typeof payload === 'object') return [payload];
    return [];
  }

  private isPlaceholderOrNil(val: any): boolean {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string') {
      const s = val.trim().toUpperCase();
      if (
        s === '' ||
        s === '[●]' ||
        s === '●' ||
        s === 'NIL' ||
        s === 'N/A' ||
        s === 'NA' ||
        s === 'NOT APPLICABLE' ||
        s === 'NOT AVAILABLE' ||
        s === 'NONE' ||
        s === '-' ||
        s === '--' ||
        s === 'TBD' ||
        s === 'NULL' ||
        s === 'UNDEFINED'
      ) {
        return true;
      }
    }
    return false;
  }

  private isFieldEmpty(val: any): boolean {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string') {
      return this.isPlaceholderOrNil(val);
    }
    if (Array.isArray(val)) {
      return val.length === 0;
    }
    if (typeof val === 'object') {
      if (val instanceof Date || val instanceof Prisma.Decimal) return false;
      return Object.keys(val).length === 0;
    }
    return false;
  }

  private areValuesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) {
      return a === b;
    }
    if (a instanceof Prisma.Decimal || (typeof a === 'object' && (a as any)?.d && (a as any)?.s)) {
      try {
        const decA = new Prisma.Decimal(a);
        const decB = new Prisma.Decimal(b);
        return decA.equals(decB);
      } catch {
        return false;
      }
    }
    if (typeof a === 'number' && typeof b === 'number') {
      return a === b;
    }
    if (typeof a === 'number' || typeof b === 'number') {
      const numA = Number(a);
      const numB = Number(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA === numB;
      }
    }
    if (
      a instanceof Date ||
      b instanceof Date ||
      (typeof a === 'string' && typeof b === 'string' && !isNaN(Date.parse(a)) && !isNaN(Date.parse(b)))
    ) {
      try {
        const dateA = new Date(a).toISOString().slice(0, 10);
        const dateB = new Date(b).toISOString().slice(0, 10);
        return dateA === dateB;
      } catch {
        // Fallback to string comparison
      }
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.trim().toLowerCase() === b.trim().toLowerCase();
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      return Boolean(a) === Boolean(b);
    }
    return false;
  }

  private checkAddOnlyField(
    section: string,
    field: string,
    existingVal: any,
    inputVal: any,
    toFill: FieldDiffToFill[],
    skipped: FieldDiffSkipped[],
    fieldReport?: FieldReportItem[],
    overwriteExisting: boolean = this.activeOverwriteMode,
  ) {
    const fieldKey = `${section}.${field}`;
    if (inputVal === undefined || inputVal === null) {
      fieldReport?.push({
        section,
        field,
        status: 'UNAVAILABLE',
        existingValue:
          existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal,
        incomingValue: inputVal,
        reason: 'Incoming value is null or undefined',
      });
      return;
    }

    if (this.isPlaceholderOrNil(inputVal)) {
      fieldReport?.push({
        section,
        field,
        status: 'SKIPPED',
        existingValue:
          existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal,
        incomingValue: inputVal,
        reason: 'Incoming value is placeholder or NIL/NA',
      });
      return;
    }

    if (this.isFieldEmpty(existingVal)) {
      toFill.push({ section, field, key: fieldKey, newValue: inputVal, status: 'FILLED' });
      fieldReport?.push({
        section,
        field,
        status: 'FILLED',
        existingValue: null,
        incomingValue: inputVal,
        reason: 'Missing/empty field populated from incoming JSON',
      });
    } else {
      const isMatch = this.areValuesEqual(existingVal, inputVal);
      if (isMatch) {
        skipped.push({
          section,
          field,
          existingValue:
            existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal,
          skippedValue: inputVal,
          reason: 'Exact match (UNCHANGED)',
          status: 'UNCHANGED',
        });
        fieldReport?.push({
          section,
          field,
          status: 'UNCHANGED',
          existingValue:
            existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal,
          incomingValue: inputVal,
          reason: 'Exact match (UNCHANGED)',
        });
      } else {
        if (overwriteExisting) {
          const oldValFormatted =
            existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal;
          toFill.push({
            section,
            field,
            key: fieldKey,
            oldValue: oldValFormatted,
            newValue: inputVal,
            status: 'OVERWRITTEN',
          });
          fieldReport?.push({
            section,
            field,
            status: 'OVERWRITTEN',
            existingValue: oldValFormatted,
            incomingValue: inputVal,
            reason: 'Authoritative overwrite of existing value',
          });
        } else {
          let reason =
            'Conflict detected: existing value differs from incoming value (mutation prevented)';
          if (
            existingVal === 0 ||
            existingVal === '0' ||
            (typeof existingVal === 'object' &&
              existingVal instanceof Prisma.Decimal &&
              existingVal.isZero())
          ) {
            reason = 'Existing zero (0) preserved';
          } else if (existingVal === false) {
            reason = 'Existing boolean (false) preserved';
          }
          skipped.push({
            section,
            field,
            existingValue:
              existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal,
            skippedValue: inputVal,
            reason,
            status: 'CONFLICT',
          });
          fieldReport?.push({
            section,
            field,
            status: 'CONFLICT',
            existingValue:
              existingVal instanceof Prisma.Decimal ? existingVal.toNumber() : existingVal,
            incomingValue: inputVal,
            reason,
          });
        }
      }
    }
  }

  private normalizeExchangeListing(val?: any): ExchangeListing | undefined {
    if (!val) return undefined;
    const str = String(val).trim().toUpperCase();
    if (str.includes('BOTH') || (str.includes('NSE') && str.includes('BSE'))) {
      return ExchangeListing.BOTH;
    }
    if (str.includes('NSE') || str.includes('EMERGE')) {
      return ExchangeListing.NSE;
    }
    if (str.includes('BSE')) {
      return ExchangeListing.BSE;
    }
    if (Object.values(ExchangeListing).includes(str as any)) {
      return str as ExchangeListing;
    }
    return undefined;
  }

  private normalizeMarketSegment(val?: any): MarketSegment | undefined {
    if (!val) return undefined;
    const str = String(val).trim().toUpperCase();
    if (str.includes('SME')) {
      return MarketSegment.SME;
    }
    if (str.includes('MAINBOARD') || str.includes('MAIN')) {
      return MarketSegment.MAINBOARD;
    }
    if (Object.values(MarketSegment).includes(str as any)) {
      return str as MarketSegment;
    }
    return undefined;
  }

  private normalizePublicationStatus(val?: any): PublicationStatus | undefined {
    if (!val) return undefined;
    const str = String(val).trim().toUpperCase();
    if (str.includes('PUBLISHED')) {
      return PublicationStatus.PUBLISHED;
    }
    if (str.includes('ARCHIVED')) {
      return PublicationStatus.ARCHIVED;
    }
    if (str.includes('DRAFT')) {
      return PublicationStatus.DRAFT;
    }
    if (Object.values(PublicationStatus).includes(str as any)) {
      return str as PublicationStatus;
    }
    return undefined;
  }

  private normalizeDocumentType(rawType?: any): DocumentType {
    if (!rawType) return DocumentType.OTHER;
    const str = String(rawType).trim().toUpperCase();
    if (str.includes('DRHP') || str.includes('DRAFT RED')) return DocumentType.DRHP;
    if (str.includes('RHP') || str.includes('RED HERRING')) return DocumentType.RHP;
    if (str.includes('PROSPECTUS')) return DocumentType.PROSPECTUS;
    if (str.includes('ANCHOR')) return DocumentType.ANCHOR_LIST;
    if (str.includes('BASIS') || str.includes('ALLOTMENT')) return DocumentType.BASIS_OF_ALLOTMENT;
    if (Object.values(DocumentType).includes(str as any)) {
      return str as DocumentType;
    }
    return DocumentType.OTHER;
  }

  private normalizeFinancialPeriodItem(fin: any): {
    fiscalPeriod: string;
    periodType: string;
    totalAssets?: number | null;
    totalRevenue?: number | null;
    pat?: number | null;
    ebitda?: number | null;
    netWorth?: number | null;
    roePercentage?: number | null;
    rocePercentage?: number | null;
    eps?: number | null;
    patMarginPercent?: number | null;
    ebitdaMarginPercent?: number | null;
  } | null {
    if (!fin || typeof fin !== 'object') return null;
    const fiscalPeriod = String(fin.fiscalPeriod || fin.fiscalYear || fin.period || '').trim();
    if (!fiscalPeriod) return null;

    let periodType = fin.periodType ? String(fin.periodType).trim().toUpperCase() : '';
    if (!periodType) {
      if (/^(Q[1-4]|3M|6M|9M|H1|H2|QUARTER)/i.test(fiscalPeriod) || /\b(Q1|Q2|Q3|Q4|3M|6M|9M|H1|H2)\b/i.test(fiscalPeriod)) {
        periodType = 'QUARTERLY';
      } else {
        periodType = 'ANNUAL';
      }
    }

    const parseNum = (v: any) => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? null : n;
    };

    return {
      fiscalPeriod,
      periodType,
      totalAssets: parseNum(fin.totalAssets ?? fin.assets),
      totalRevenue: parseNum(fin.totalRevenue ?? fin.revenue),
      pat: parseNum(fin.pat ?? fin.patNetProfit ?? fin.netProfit),
      ebitda: parseNum(fin.ebitda),
      netWorth: parseNum(fin.netWorth ?? fin.nav ?? fin.ronw),
      roePercentage: parseNum(fin.roePercentage ?? fin.roePercent ?? fin.roe),
      rocePercentage: parseNum(fin.rocePercentage ?? fin.rocePercent ?? fin.roce),
      eps: parseNum(fin.eps),
      patMarginPercent: parseNum(fin.patMarginPercent ?? fin.patPercent ?? fin.patMargin),
      ebitdaMarginPercent: parseNum(fin.ebitdaMarginPercent ?? fin.ebitdaPercent ?? fin.ebitdaMargin),
    };
  }

  private normalizeAnchorInvestorItem(anc: any): {
    anchorName: string;
    sharesAllotted?: number | null;
    amtCr?: number | null;
    pctAllocated?: number | null;
    pctOfIssue?: number | null;
  } | null {
    if (!anc || typeof anc !== 'object') return null;
    const anchorName = String(anc.anchorName || anc.investorName || anc.name || '').trim();
    if (!anchorName) return null;

    const parseNum = (v: any) => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? null : n;
    };

    const parseShares = (v: any) => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? Math.round(v) : parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
      return isNaN(n) ? null : n;
    };

    return {
      anchorName,
      sharesAllotted: parseShares(anc.sharesAllotted),
      amtCr: parseNum(anc.amtCr ?? anc.amountCr),
      pctAllocated: parseNum(anc.pctAllocated ?? anc.percentAllocated),
      pctOfIssue: parseNum(anc.pctOfIssue ?? anc.percentOfIssue),
    };
  }

  private normalizeIncomingAddOnlyItem(item: any) {
    const rawIpo = item?.ipo && typeof item.ipo === 'object' ? item.ipo : item || {};
    const rawCompany = {
      ...(rawIpo.company && typeof rawIpo.company === 'object' ? rawIpo.company : {}),
      ...(item?.company && typeof item.company === 'object' ? item.company : {}),
    };
    const rawLifecycle = {
      ...(rawIpo.lifecycle && typeof rawIpo.lifecycle === 'object' ? rawIpo.lifecycle : {}),
      ...(item?.lifecycle && typeof item.lifecycle === 'object' ? item.lifecycle : {}),
    };
    const rawAllotmentConfig = {
      ...(rawIpo.allotmentConfig && typeof rawIpo.allotmentConfig === 'object' ? rawIpo.allotmentConfig : {}),
      ...(item?.allotmentConfig && typeof item.allotmentConfig === 'object' ? item.allotmentConfig : {}),
    };
    const rawGmp = {
      ...(rawIpo.gmp && typeof rawIpo.gmp === 'object' ? rawIpo.gmp : {}),
      ...(item?.gmp && typeof item.gmp === 'object' ? item.gmp : {}),
    };
    const rawGmpSub = rawIpo.gmpSubscription || item?.gmpSubscription || {};
    const rawIdentifiers = {
      ...(rawIpo.identifiers && typeof rawIpo.identifiers === 'object' ? rawIpo.identifiers : {}),
      ...(item?.identifiers && typeof item.identifiers === 'object' ? item.identifiers : {}),
    };
    const rawCanonical = {
      ...(rawIpo.canonical && typeof rawIpo.canonical === 'object' ? rawIpo.canonical : {}),
      ...(item?.canonical && typeof item.canonical === 'object' ? item.canonical : {}),
    };
    const rawValuation = {
      ...(rawIpo.valuation && typeof rawIpo.valuation === 'object' ? rawIpo.valuation : {}),
      ...(item?.valuation && typeof item.valuation === 'object' ? item.valuation : {}),
    };
    const rawTimeline = {
      ...(rawIpo.timeline && typeof rawIpo.timeline === 'object' ? rawIpo.timeline : {}),
      ...(item?.timeline && typeof item.timeline === 'object' ? item.timeline : {}),
    };
    const rawOffer = {
      ...(rawIpo.offer && typeof rawIpo.offer === 'object' ? rawIpo.offer : {}),
      ...(item?.offer && typeof item.offer === 'object' ? item.offer : {}),
    };
    const rawResearch = {
      ...(rawIpo.research && typeof rawIpo.research === 'object' ? rawIpo.research : {}),
      ...(item?.research && typeof item.research === 'object' ? item.research : {}),
    };
    const arrayParticipants = Array.isArray(rawIpo.participants)
      ? rawIpo.participants
      : Array.isArray(item?.participants)
        ? item.participants
        : [];
    const arrayRegistrar = arrayParticipants.find(
      (p: any) => p && (String(p.role).toUpperCase() === 'REGISTRAR' || String(p.type).toUpperCase() === 'REGISTRAR'),
    );
    const arrayLeadManagers = arrayParticipants.filter(
      (p: any) => p && (String(p.role).toUpperCase() === 'BRLM' || String(p.role).toUpperCase() === 'LEAD_MANAGER' || String(p.role).toUpperCase() === 'CO_BRLM'),
    );

    const rawParticipants: Record<string, any> = {
      ...(rawIpo.participants && typeof rawIpo.participants === 'object' && !Array.isArray(rawIpo.participants) ? rawIpo.participants : {}),
      ...(item?.participants && typeof item.participants === 'object' && !Array.isArray(item.participants) ? item.participants : {}),
    };

    if (arrayRegistrar) {
      if (arrayRegistrar.name && !rawParticipants.registrarName) rawParticipants.registrarName = arrayRegistrar.name;
      if (arrayRegistrar.phone && !rawParticipants.registrarPhone) rawParticipants.registrarPhone = arrayRegistrar.phone;
      if (arrayRegistrar.email && !rawParticipants.registrarEmail) rawParticipants.registrarEmail = arrayRegistrar.email;
      if (arrayRegistrar.website && !rawParticipants.registrarWebsite) rawParticipants.registrarWebsite = arrayRegistrar.website;
    }
    if (arrayLeadManagers.length > 0 && !rawParticipants.leadManagers && !rawParticipants.leadManager) {
      rawParticipants.leadManagers = arrayLeadManagers.map((lm: any) => lm.name).filter(Boolean);
    }

    if (item?.registrarName && !rawParticipants.registrarName) rawParticipants.registrarName = item.registrarName;
    if (rawIpo?.registrarName && !rawParticipants.registrarName) rawParticipants.registrarName = rawIpo.registrarName;
    if (item?.registrarPhone && !rawParticipants.registrarPhone) rawParticipants.registrarPhone = item.registrarPhone;
    if (rawIpo?.registrarPhone && !rawParticipants.registrarPhone) rawParticipants.registrarPhone = rawIpo.registrarPhone;
    if (item?.registrarEmail && !rawParticipants.registrarEmail) rawParticipants.registrarEmail = item.registrarEmail;
    if (rawIpo?.registrarEmail && !rawParticipants.registrarEmail) rawParticipants.registrarEmail = rawIpo.registrarEmail;
    if (item?.registrarWebsite && !rawParticipants.registrarWebsite) rawParticipants.registrarWebsite = item.registrarWebsite;
    if (rawIpo?.registrarWebsite && !rawParticipants.registrarWebsite) rawParticipants.registrarWebsite = rawIpo.registrarWebsite;
    const rawFinancials = Array.isArray(rawIpo.financials)
      ? rawIpo.financials
      : Array.isArray(item?.financials)
        ? item.financials
        : Array.isArray(rawCompany.financials)
          ? rawCompany.financials
          : [];
    const rawDocuments = Array.isArray(rawIpo.documents)
      ? rawIpo.documents
      : Array.isArray(item?.documents)
        ? item.documents
        : [];
    const rawAnchorInvestors = Array.isArray(rawIpo.anchorInvestors)
      ? rawIpo.anchorInvestors
      : Array.isArray(item?.anchorInvestors)
        ? item.anchorInvestors
        : [];

    const targetIpoId = (
      item?.id ||
      item?.ipoId ||
      item?.targetIpoId ||
      rawIpo.id ||
      rawIpo.ipoId ||
      rawIpo.targetIpoId
    )?.trim?.();

    const cin = (
      rawIdentifiers.cin ||
      rawCompany.cin ||
      rawIpo.company?.cin ||
      item?.cin ||
      rawIpo.cin
    )?.trim?.();

    const isin = (
      rawIdentifiers.isin ||
      rawIpo.isin ||
      rawCanonical.isin ||
      item?.isin
    )?.trim?.().toUpperCase();

    const symbol = (
      rawIdentifiers.tradingSymbol ||
      rawIdentifiers.symbol ||
      rawIdentifiers.nseSymbol ||
      rawIdentifiers.bseSymbol ||
      item?.tradingSymbol ||
      item?.symbol ||
      item?.nseSymbol ||
      item?.bseSymbol ||
      rawIpo.tradingSymbol ||
      rawIpo.symbol ||
      rawIpo.nseSymbol ||
      rawIpo.bseSymbol ||
      rawCanonical.symbol ||
      rawCanonical.tradingSymbol
    )?.trim?.().toUpperCase();

    const nseSymbol = (rawIdentifiers.nseSymbol || item?.nseSymbol || rawIpo.nseSymbol)?.trim?.().toUpperCase();
    const bseSymbol = (rawIdentifiers.bseSymbol || item?.bseSymbol || rawIpo.bseSymbol)?.trim?.().toUpperCase();

    const legalName = (
      rawIpo.legalCompanyName ||
      item?.legalCompanyName ||
      rawCompany.legalName ||
      rawIpo.company?.legalName ||
      item?.legalName ||
      rawCompany.companyName ||
      item?.companyName ||
      rawCompany.displayName ||
      rawIpo.displayName ||
      item?.displayName ||
      item?.ipoName ||
      rawIpo.name ||
      item?.name
    )?.trim?.();

    const displayName = (
      rawIpo.displayName ||
      item?.displayName ||
      rawCompany.displayName ||
      rawIpo.company?.displayName ||
      item?.companyName ||
      item?.ipoName ||
      rawIpo.legalCompanyName ||
      item?.legalCompanyName ||
      rawCompany.legalName ||
      rawIpo.company?.legalName ||
      item?.name
    )?.trim?.();

    const inputName =
      legalName ||
      displayName ||
      item?._sourceFileName?.replace(/\.json$/i, '') ||
      'Unknown IPO';

    const exchange = this.normalizeExchangeListing(
      rawCanonical.exchangeListing ||
      rawCanonical.exchange ||
      rawIpo.exchange ||
      item?.exchange ||
      item?.listingExchange
    );

    const marketSegment = this.normalizeMarketSegment(
      rawCanonical.marketSegment ||
      rawIpo.marketSegment ||
      item?.marketSegment ||
      item?.issueType
    );

    const publicationStatus = this.normalizePublicationStatus(
      rawCanonical.publicationStatus ||
      rawIpo.publicationStatus ||
      item?.publicationStatus
    );

    const sourceSlug = (
      item?.slug ||
      rawIpo?.slug ||
      item?.ipoGuruSlug ||
      (rawIdentifiers as any)?.ipoGuruSlug ||
      item?._sourceSlug ||
      ''
    )?.trim?.() || undefined;

    return {
      rawIpo,
      rawCompany,
      rawLifecycle,
      rawAllotmentConfig,
      rawGmp,
      rawGmpSub,
      rawIdentifiers,
      rawCanonical,
      rawValuation,
      rawTimeline,
      rawOffer,
      rawParticipants,
      rawFinancials,
      rawDocuments,
      rawAnchorInvestors,
      targetIpoId,
      cin,
      isin,
      symbol,
      nseSymbol,
      bseSymbol,
      legalName,
      displayName,
      inputName,
      exchange,
      marketSegment,
      publicationStatus,
      sourceSlug,
      rawResearch,
    };
  }

  private findMatchingIpoForAddOnly(
    item: any,
    allExistingIpos: any[],
  ): {
    status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
    matchedIpo?: any;
    reason: string;
  } {
    const norm = this.normalizeIncomingAddOnlyItem(item);

    // 1. Explicit ID
    if (
      norm.targetIpoId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        norm.targetIpoId,
      )
    ) {
      const match = allExistingIpos.find((i) => i.id === norm.targetIpoId);
      if (match) {
        return {
          status: 'MATCHED',
          matchedIpo: match,
          reason: `Matched by explicit ID (${norm.targetIpoId})`,
        };
      }
    }

    // 2. Priority 1: CIN
    if (norm.cin) {
      const matches = allExistingIpos.filter(
        (i) =>
          i.company?.cin &&
          i.company.cin.toLowerCase() === norm.cin!.toLowerCase(),
      );
      if (matches.length === 1) {
        return {
          status: 'MATCHED',
          matchedIpo: matches[0],
          reason: `Matched by CIN '${norm.cin}'`,
        };
      }
      if (matches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          reason: `Ambiguous match: ${matches.length} IPOs share CIN '${norm.cin}'`,
        };
      }
    }

    // 3. Priority 2: ISIN
    if (norm.isin) {
      const matches = allExistingIpos.filter(
        (i) => i.isin && i.isin.toUpperCase() === norm.isin!.toUpperCase(),
      );
      if (matches.length === 1) {
        return {
          status: 'MATCHED',
          matchedIpo: matches[0],
          reason: `Matched by ISIN '${norm.isin}'`,
        };
      }
      if (matches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          reason: `Ambiguous match: ${matches.length} IPOs share ISIN '${norm.isin}'`,
        };
      }
    }

    // 4. Priority 3: Symbol
    if (norm.symbol) {
      const matches = allExistingIpos.filter(
        (i) =>
          (i.symbol && i.symbol.toUpperCase() === norm.symbol) ||
          (i.nseSymbol && i.nseSymbol.toUpperCase() === norm.symbol) ||
          (i.bseSymbol && i.bseSymbol.toUpperCase() === norm.symbol),
      );
      if (matches.length === 1) {
        return {
          status: 'MATCHED',
          matchedIpo: matches[0],
          reason: `Matched by Symbol '${norm.symbol}'`,
        };
      }
      if (matches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          reason: `Ambiguous match: ${matches.length} IPOs share Symbol '${norm.symbol}'`,
        };
      }
    }

    // 5. Priority 4: Normalized Company Name
    const candidateNames = Array.from(
      new Set(
        [norm.legalName, norm.displayName, norm.inputName].filter(
          Boolean,
        ) as string[],
      ),
    );

    for (const nameCandidate of candidateNames) {
      const normInput = normalizeName(nameCandidate);
      if (normInput) {
        const exactMatches = allExistingIpos.filter((i) => {
          const normLegal = i.company?.legalName
            ? normalizeName(i.company.legalName)
            : '';
          const normDisplay = i.company?.displayName
            ? normalizeName(i.company.displayName)
            : '';
          return normLegal === normInput || normDisplay === normInput;
        });

        if (exactMatches.length === 1) {
          return {
            status: 'MATCHED',
            matchedIpo: exactMatches[0],
            reason: `Matched by Normalized Name '${nameCandidate}'`,
          };
        }
        if (exactMatches.length > 1) {
          return {
            status: 'AMBIGUOUS',
            reason: `Ambiguous match: ${exactMatches.length} IPOs match Name '${nameCandidate}'`,
          };
        }
      }
    }

    return {
      status: 'UNMATCHED',
      reason: 'No matching existing IPO found in database',
    };
  }

  private diffIpoForAddOnly(
    existingIpo: any,
    item: any,
    overwriteExisting: boolean = false,
  ): {
    fieldsToFill: FieldDiffToFill[];
    fieldsSkipped: FieldDiffSkipped[];
    fieldReport: FieldReportItem[];
  } {
    const prevMode = this.activeOverwriteMode;
    this.activeOverwriteMode = overwriteExisting;
    try {
      const toFill: FieldDiffToFill[] = [];
      const skipped: FieldDiffSkipped[] = [];
      const fieldReport: FieldReportItem[] = [];

    const norm = this.normalizeIncomingAddOnlyItem(item);
    const existingCompany = existingIpo.company || {};

    // 1. Company Level
    this.checkAddOnlyField(
      'company',
      'legalName',
      existingCompany.legalName,
      norm.legalName,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'displayName',
      existingCompany.displayName,
      norm.displayName,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'cin',
      existingCompany.cin,
      norm.cin,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'contactPerson',
      existingCompany.contactPerson,
      norm.rawCompany.contactPerson || item.contactPerson,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'logoUrl',
      existingCompany.logoUrl,
      norm.rawCompany.logoUrl || item.logoUrl,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'website',
      existingCompany.website,
      norm.rawCompany.website || item.website,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'phone',
      existingCompany.phone,
      norm.rawCompany.phone || item.companyPhone || item.phone,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'email',
      existingCompany.email,
      norm.rawCompany.email || item.companyEmail || item.email,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'aboutDescription',
      existingCompany.aboutDescription,
      norm.rawCompany.aboutDescription || item.aboutDescription || norm.rawCompany.about || item.about || item.notes,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'sector',
      existingCompany.sector,
      norm.rawCompany.sector || item.sector,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'company',
      'industry',
      existingCompany.industry,
      norm.rawCompany.industry || item.industry,
      toFill,
      skipped,
      fieldReport,
    );

    // 2. IPO Core Level
    this.checkAddOnlyField(
      'ipo',
      'symbol',
      existingIpo.symbol,
      norm.symbol,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'isin',
      existingIpo.isin,
      norm.isin,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'nseSymbol',
      existingIpo.nseSymbol,
      norm.nseSymbol,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'bseSymbol',
      existingIpo.bseSymbol,
      norm.bseSymbol,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'exchange',
      existingIpo.exchange,
      norm.exchange,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'marketSegment',
      existingIpo.marketSegment,
      norm.marketSegment,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'publicationStatus',
      existingIpo.publicationStatus,
      norm.publicationStatus,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'priceBandLow',
      existingIpo.priceBandLow,
      norm.rawCanonical.priceBandLow ?? norm.rawIpo.priceBandLow ?? norm.rawIpo.floorPrice ?? norm.rawIpo.priceBandMin ?? item.priceBandLow ?? item.priceBandMin ?? item.floorPrice,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'priceBandHigh',
      existingIpo.priceBandHigh,
      norm.rawCanonical.priceBandHigh ?? norm.rawIpo.priceBandHigh ?? norm.rawIpo.capPrice ?? norm.rawIpo.priceBandMax ?? item.priceBandHigh ?? item.priceBandMax ?? item.capPrice,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'faceValue',
      existingIpo.faceValue,
      norm.rawCanonical.faceValue ?? norm.rawIpo.faceValue ?? item.faceValue,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'lotSize',
      existingIpo.lotSize,
      norm.rawCanonical.lotSize ?? norm.rawIpo.lotSize ?? norm.rawIpo.marketLot ?? item.lotSize ?? item.marketLot,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'minimumLots',
      existingIpo.minimumLots,
      norm.rawCanonical.minimumLots ?? norm.rawIpo.minimumLots ?? item.minimumLots,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'issueSize',
      existingIpo.issueSize,
      norm.rawCanonical.totalIssueSize ?? norm.rawCanonical.issueSize ?? norm.rawIpo.totalIssueSize ?? norm.rawIpo.issueSize ?? item.totalIssueSize ?? item.issueSize,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'freshIssueSize',
      existingIpo.freshIssueSize,
      norm.rawCanonical.freshIssueSize ?? norm.rawIpo.freshIssueSize ?? item.freshIssueSize,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'ofsSize',
      existingIpo.ofsSize,
      norm.rawCanonical.offerForSaleSize ?? norm.rawCanonical.ofsSize ?? norm.rawIpo.ofsSize ?? item.ofsSize,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'issueShareCount',
      existingIpo.issueShareCount,
      norm.rawCanonical.totalShares ?? norm.rawCanonical.issueShareCount ?? norm.rawIpo.totalShares ?? norm.rawIpo.issueShareCount ?? item.totalShares ?? item.issueShareCount ?? item.totalIssueShares,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'freshIssueShareCount',
      existingIpo.freshIssueShareCount,
      norm.rawCanonical.freshIssueShareCount ?? norm.rawIpo.freshIssueShareCount ?? item.freshIssueShareCount ?? item.freshIssueShares,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'ofsShareCount',
      existingIpo.ofsShareCount,
      norm.rawCanonical.ofsShareCount ?? norm.rawIpo.ofsShareCount ?? item.ofsShareCount ?? item.ofsShares,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'listingPrice',
      existingIpo.listingPrice,
      norm.rawCanonical.listingPrice ?? norm.rawIpo.listingPrice ?? item.listingPrice,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'listingGainPct',
      existingIpo.listingGainPct,
      norm.rawCanonical.listingGainPct ?? norm.rawIpo.listingGainPct ?? item.listingGainPct,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'profitAmount',
      existingIpo.profitAmount,
      norm.rawIpo.profitAmount ?? item.profitAmount,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'profitPercentage',
      existingIpo.profitPercentage,
      norm.rawIpo.profitPercentage ?? item.profitPercentage,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'preIpoEps',
      existingIpo.preIpoEps,
      norm.rawValuation.preIpoEps ?? norm.rawIpo.preIpoEps ?? item.preIpoEps,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'postIpoEps',
      existingIpo.postIpoEps,
      norm.rawValuation.postIpoEps ?? norm.rawIpo.postIpoEps ?? item.postIpoEps,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'preIpoPe',
      existingIpo.preIpoPe,
      norm.rawValuation.preIpoPe ?? norm.rawIpo.preIpoPe ?? item.preIpoPe,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'postIpoPe',
      existingIpo.postIpoPe,
      norm.rawValuation.postIpoPe ?? norm.rawIpo.postIpoPe ?? item.postIpoPe,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'preIpoPromoterHolding',
      existingIpo.preIpoPromoterHolding,
      norm.rawValuation.preIpoPromoterHolding ?? norm.rawIpo.preIpoPromoterHolding ?? item.preIpoPromoterHolding,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'postIpoPromoterHolding',
      existingIpo.postIpoPromoterHolding,
      norm.rawValuation.postIpoPromoterHolding ?? norm.rawIpo.postIpoPromoterHolding ?? item.postIpoPromoterHolding,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'preIpoMarketCap',
      existingIpo.preIpoMarketCap,
      norm.rawValuation.preIpoMarketCap ?? norm.rawIpo.preIpoMarketCap ?? item.preIpoMarketCap,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'ipo',
      'postIpoMarketCap',
      existingIpo.postIpoMarketCap,
      norm.rawValuation.postIpoMarketCap ?? norm.rawIpo.postIpoMarketCap ?? item.postIpoMarketCap,
      toFill,
      skipped,
      fieldReport,
    );

    // 3. Lifecycle Events / Timeline
    const existingEvents = existingIpo.lifecycleEvents || [];
    const eventTypeMap: Record<string, string | undefined> = {
      OPEN: norm.rawTimeline.openDate || norm.rawTimeline.issueOpenDate || norm.rawLifecycle.openDate || norm.rawLifecycle.issueOpenDate || norm.rawIpo.openDate || item.openDate,
      CLOSE: norm.rawTimeline.closeDate || norm.rawTimeline.issueCloseDate || norm.rawLifecycle.closeDate || norm.rawLifecycle.issueCloseDate || norm.rawIpo.closeDate || item.closeDate,
      BASIS_OF_ALLOTMENT: norm.rawTimeline.allotmentDate || norm.rawTimeline.basisOfAllotmentDate || norm.rawLifecycle.allotmentDate || norm.rawLifecycle.basisOfAllotmentDate || norm.rawIpo.allotmentDate || item.allotmentDate,
      LISTING: norm.rawTimeline.listingDate || norm.rawLifecycle.listingDate || norm.rawIpo.listingDate || item.listingDate,
      REFUND_INITIATION: norm.rawTimeline.refundInitiationDate || norm.rawTimeline.refundDate || norm.rawLifecycle.refundInitiationDate || norm.rawLifecycle.refundDate || norm.rawIpo.refundDate || item.refundInitiationDate || item.refundDate,
      DEMAT_CREDIT: norm.rawTimeline.creditToDematDate || norm.rawTimeline.dematCreditDate || norm.rawLifecycle.creditToDematDate || norm.rawLifecycle.dematCreditDate || norm.rawIpo.creditToDematDate || norm.rawIpo.dematCreditDate || item.creditToDematDate || item.dematCreditDate,
      DRHP: norm.rawTimeline.drhpDate || norm.rawLifecycle.drhpDate || item.drhpDate,
      RHP: norm.rawTimeline.rhpDate || norm.rawLifecycle.rhpDate || item.rhpDate,
      ANCHOR: norm.rawTimeline.anchorDate || norm.rawTimeline.anchorBidDate || norm.rawLifecycle.anchorDate || norm.rawLifecycle.anchorBidDate || item.anchorDate || item.anchorBidDate,
    };

    for (const [evType, inputDateStr] of Object.entries(eventTypeMap)) {
      if (inputDateStr && !this.isPlaceholderOrNil(inputDateStr)) {
        const existingEv = existingEvents.find(
          (e: any) => e.eventType === evType,
        );
        const existingDate = existingEv?.eventDate
          ? new Date(existingEv.eventDate).toISOString().slice(0, 10)
          : null;
        this.checkAddOnlyField(
          'lifecycle',
          evType,
          existingDate,
          inputDateStr,
          toFill,
          skipped,
          fieldReport,
        );
      }
    }

    // 4. Allotment Config & Registrar
    const existingAllotConfig = existingIpo.allotmentConfig || {};
    this.checkAddOnlyField(
      'allotmentConfig',
      'registrar',
      existingAllotConfig.registrar,
      norm.rawParticipants.registrarName || norm.rawParticipants.registrar || norm.rawAllotmentConfig.registrar || norm.rawIpo.registrar || item.registrar,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'allotmentConfig',
      'registrarIpoCode',
      existingAllotConfig.registrarIpoCode,
      norm.rawAllotmentConfig.registrarIpoCode || item.registrarIpoCode,
      toFill,
      skipped,
      fieldReport,
    );
    this.checkAddOnlyField(
      'allotmentConfig',
      'allotmentSourceUrl',
      existingAllotConfig.allotmentSourceUrl,
      norm.rawAllotmentConfig.allotmentSourceUrl || norm.rawAllotmentConfig.allotmentUrl || item.allotmentSourceUrl,
      toFill,
      skipped,
      fieldReport,
    );

    // 5. Documents (Array + Flat Legacy URLs)
    const existingDocs = existingIpo.documents || [];
    const gatheredDocs: Array<{ type: DocumentType; url?: string; title?: string }> = [];

    if (Array.isArray(norm.rawDocuments)) {
      for (const d of norm.rawDocuments) {
        if (!d || typeof d !== 'object') continue;
        const type = this.normalizeDocumentType(d.documentType || d.type);
        const url = (d.documentUrl || d.sourceUrl || d.url || '').trim();
        const title = (d.documentTitle || d.title || d.fileName || '').trim();
        if (url || title || type !== DocumentType.OTHER) {
          gatheredDocs.push({ type, url: url || undefined, title: title || undefined });
        }
      }
    }

    const flatDocMap: Array<[DocumentType, string | undefined]> = [
      [DocumentType.DRHP, item.drhpUrl || item.drhp || norm.rawIpo.drhpUrl],
      [DocumentType.RHP, item.rhpUrl || item.rhp || norm.rawIpo.rhpUrl],
      [DocumentType.PROSPECTUS, item.prospectusUrl || norm.rawIpo.prospectusUrl],
      [DocumentType.ANCHOR_LIST, item.anchorListUrl || norm.rawIpo.anchorListUrl],
    ];

    for (const [flatType, flatUrl] of flatDocMap) {
      if (flatUrl && !gatheredDocs.some((g) => g.type === flatType)) {
        gatheredDocs.push({ type: flatType, url: flatUrl.trim() });
      }
    }

    for (const gDoc of gatheredDocs) {
      const existingDoc = existingDocs.find(
        (d: any) =>
          d.documentType === gDoc.type &&
          (gDoc.type !== DocumentType.OTHER ||
            (gDoc.url && d.sourceUrl === gDoc.url) ||
            (gDoc.title && d.fileName === gDoc.title)),
      );
      if (!existingDoc) {
        toFill.push({
          section: 'documents',
          field: `${gDoc.type} (NEW DOCUMENT)`,
          key: `documents.${gDoc.type}`,
          newValue: gDoc.url || gDoc.title || gDoc.type,
          status: 'FILLED',
        });
        fieldReport.push({
          section: 'documents',
          field: `${gDoc.type} (NEW DOCUMENT)`,
          status: 'FILLED',
          existingValue: null,
          incomingValue: gDoc.url || gDoc.title || gDoc.type,
          reason: `New document ${gDoc.type} added`,
        });
      } else if (gDoc.url) {
        this.checkAddOnlyField(
          'documents',
          `${gDoc.type}.sourceUrl`,
          existingDoc.sourceUrl,
          gDoc.url,
          toFill,
          skipped,
          fieldReport,
        );
      }
    }

    // 6. Offer Categories & Retail Limits
    const existingCategories = existingIpo.offerCategories || [];
    const inputCategories =
      norm.rawIpo.offerCategories ||
      item.offerCategories ||
      norm.rawIpo.offerBreakup ||
      item.offerBreakup ||
      item.reservation ||
      [];

    const retailInput: any = {};
    if (norm.rawOffer.retailMinLots !== undefined || item.retailMinLots !== undefined)
      retailInput.minLots = norm.rawOffer.retailMinLots ?? item.retailMinLots;
    if (norm.rawOffer.retailMaxLots !== undefined || item.retailMaxLots !== undefined)
      retailInput.maxLots = norm.rawOffer.retailMaxLots ?? item.retailMaxLots;
    if (norm.rawOffer.retailMinShares !== undefined || item.retailMinShares !== undefined)
      retailInput.minShares = norm.rawOffer.retailMinShares ?? item.retailMinShares;
    if (norm.rawOffer.retailMaxShares !== undefined || item.retailMaxShares !== undefined)
      retailInput.maxShares = norm.rawOffer.retailMaxShares ?? item.retailMaxShares;
    if (norm.rawOffer.retailMinAmount !== undefined || item.retailMinAmount !== undefined)
      retailInput.minAmount = norm.rawOffer.retailMinAmount ?? item.retailMinAmount;
    if (norm.rawOffer.retailMaxAmount !== undefined || item.retailMaxAmount !== undefined)
      retailInput.maxAmount = norm.rawOffer.retailMaxAmount ?? item.retailMaxAmount;
    if (norm.rawOffer.retailAllocationPercent !== undefined || item.retailAllocationPct !== undefined)
      retailInput.allocationPct = norm.rawOffer.retailAllocationPercent ?? item.retailAllocationPct;

    const mergedInputCategories = [...(Array.isArray(inputCategories) ? inputCategories : [])];
    if (Object.keys(retailInput).length > 0) {
      const existingInList = mergedInputCategories.find(
        (c: any) => String(c.category || c.categoryCode || '').toUpperCase() === 'RETAIL',
      );
      if (!existingInList) {
        mergedInputCategories.push({ category: 'RETAIL', ...retailInput });
      } else {
        Object.assign(existingInList, { ...retailInput, ...existingInList });
      }
    }

    if (norm.rawOffer.qibAllocationPercent !== undefined) {
      const existingQib = mergedInputCategories.find(
        (c: any) => String(c.category || c.categoryCode || '').toUpperCase() === 'QIB',
      );
      if (!existingQib) {
        mergedInputCategories.push({ category: 'QIB', allocationPct: norm.rawOffer.qibAllocationPercent });
      } else if (existingQib.allocationPct === undefined) {
        existingQib.allocationPct = norm.rawOffer.qibAllocationPercent;
      }
    }

    if (norm.rawOffer.niiAllocationPercent !== undefined) {
      const existingNii = mergedInputCategories.find(
        (c: any) => String(c.category || c.categoryCode || '').toUpperCase() === 'NII',
      );
      if (!existingNii) {
        mergedInputCategories.push({ category: 'NII', allocationPct: norm.rawOffer.niiAllocationPercent });
      } else if (existingNii.allocationPct === undefined) {
        existingNii.allocationPct = norm.rawOffer.niiAllocationPercent;
      }
    }

    if (mergedInputCategories.length > 0) {
      for (const catItem of mergedInputCategories) {
        if (!catItem || typeof catItem !== 'object') continue;
        let catName = String(
          catItem.category || catItem.categoryCode || '',
        ).toUpperCase();
        if (catName.includes('RETAIL')) catName = 'RETAIL';
        else if (catName.includes('EMPLOYEE')) catName = 'EMPLOYEE';
        else if (catName.includes('SHAREHOLDER')) catName = 'SHAREHOLDER';
        else if (catName.includes('SNII') || catName.includes('NII_SMALL')) catName = 'NII_SMALL';
        else if (catName.includes('BNII') || catName.includes('NII_BIG')) catName = 'NII_BIG';
        else if (catName.includes('NII') || catName.includes('NON_INSTITUTIONAL')) catName = 'NII';
        else if (catName.includes('QIB') || catName.includes('QUALIFIED')) catName = 'QIB';
        if (!catName || !Object.values(OfferCategoryType).includes(catName as any))
          continue;

        const existingCat = existingCategories.find(
          (c: any) => c.category === catName,
        );
        if (!existingCat) {
          toFill.push({
            section: 'offerCategories',
            field: `${catName} (NEW CATEGORY)`,
            key: `offerCategories.${catName}`,
            newValue: catItem,
            status: 'FILLED',
          });
          fieldReport.push({
            section: 'offerCategories',
            field: `${catName} (NEW CATEGORY)`,
            status: 'FILLED',
            existingValue: null,
            incomingValue: catItem,
            reason: `New offer category ${catName} added`,
          });
        } else {
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.allocationPct`,
            existingCat.allocationPct,
            catItem.allocationPct ?? catItem.allocationPercentage ?? catItem.allocationPercent,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.minLots`,
            existingCat.minLots,
            catItem.minLots,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.maxLots`,
            existingCat.maxLots,
            catItem.maxLots,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.minShares`,
            existingCat.minShares,
            catItem.minShares,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.maxShares`,
            existingCat.maxShares,
            catItem.maxShares,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.minAmount`,
            existingCat.minAmount,
            catItem.minAmount,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.maxAmount`,
            existingCat.maxAmount,
            catItem.maxAmount,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.isUpiEligible`,
            existingCat.isUpiEligible,
            catItem.isUpiEligible,
            toFill,
            skipped,
            fieldReport,
          );
        }
      }
    }

    // 7. Company Financials (Record & Field Level Merge for ALL periods)
    const existingFinancials = existingCompany.financials || [];
    const inputFinancials = norm.rawFinancials;
    if (Array.isArray(inputFinancials)) {
      for (const rawFin of inputFinancials) {
        const finItem = this.normalizeFinancialPeriodItem(rawFin);
        if (!finItem) continue;
        const period = finItem.fiscalPeriod;
        const periodType = finItem.periodType;

        const existingFin = existingFinancials.find(
          (f: any) =>
            f.fiscalPeriod === period &&
            (f.periodType || 'ANNUAL') === periodType,
        );
        if (!existingFin) {
          toFill.push({
            section: 'financials',
            field: `${period} (${periodType}) (NEW PERIOD)`,
            key: `financials.${period}`,
            newValue: finItem,
            status: 'FILLED',
          });
          fieldReport.push({
            section: 'financials',
            field: `${period} (${periodType}) (NEW PERIOD)`,
            status: 'FILLED',
            existingValue: null,
            incomingValue: finItem,
            reason: `New financial period ${period} (${periodType}) added`,
          });
        } else {
          this.checkAddOnlyField(
            'financials',
            `${period}.totalAssets`,
            existingFin.totalAssets,
            finItem.totalAssets,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.totalRevenue`,
            existingFin.totalRevenue,
            finItem.totalRevenue,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.pat`,
            existingFin.pat,
            finItem.pat,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.ebitda`,
            existingFin.ebitda,
            finItem.ebitda,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.netWorth`,
            existingFin.netWorth,
            finItem.netWorth,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.roePercentage`,
            existingFin.roePercentage,
            finItem.roePercentage,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.rocePercentage`,
            existingFin.rocePercentage,
            finItem.rocePercentage,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.eps`,
            existingFin.eps,
            finItem.eps,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.patMarginPercent`,
            existingFin.patMarginPercent,
            finItem.patMarginPercent,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.ebitdaMarginPercent`,
            existingFin.ebitdaMarginPercent,
            finItem.ebitdaMarginPercent,
            toFill,
            skipped,
            fieldReport,
          );
        }
      }
    }

    // 8. Anchor Investors & Anchor Details
    const anchorInvestorsList = norm.rawAnchorInvestors;
    if (Array.isArray(anchorInvestorsList) && anchorInvestorsList.length > 0) {
      const existingAnchorDoc = existingDocs.find((d: any) => d.documentType === 'ANCHOR_LIST');
      const existingExt = (existingAnchorDoc?.extractionData as any) || {};
      const existingAnchors: any[] = Array.isArray(existingExt.anchorInvestors)
        ? existingExt.anchorInvestors
        : [];

      for (const rawAnc of anchorInvestorsList) {
        const anc = this.normalizeAnchorInvestorItem(rawAnc);
        if (!anc) continue;
        const ancName = anc.anchorName;
        const lowerAncName = ancName.toLowerCase();
        const existingAnc = existingAnchors.find(
          (a: any) => (a.anchorName || a.investorName || '').trim().toLowerCase() === lowerAncName,
        );
        if (!existingAnc) {
          toFill.push({
            section: 'anchorInvestors',
            field: `${ancName} (NEW ANCHOR)`,
            key: `anchorInvestors.${ancName}`,
            newValue: anc,
            status: 'FILLED',
          });
          fieldReport.push({
            section: 'anchorInvestors',
            field: `${ancName} (NEW ANCHOR)`,
            status: 'FILLED',
            existingValue: null,
            incomingValue: anc,
            reason: `New anchor investor ${ancName} added`,
          });
        } else {
          this.checkAddOnlyField(
            'anchorInvestors',
            `${ancName}.sharesAllotted`,
            existingAnc.sharesAllotted,
            anc.sharesAllotted,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'anchorInvestors',
            `${ancName}.amtCr`,
            existingAnc.amtCr ?? existingAnc.amountCr,
            anc.amtCr,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'anchorInvestors',
            `${ancName}.pctAllocated`,
            existingAnc.pctAllocated ?? existingAnc.percentAllocated,
            anc.pctAllocated,
            toFill,
            skipped,
            fieldReport,
          );
          this.checkAddOnlyField(
            'anchorInvestors',
            `${ancName}.pctOfIssue`,
            existingAnc.pctOfIssue ?? existingAnc.percentOfIssue,
            anc.pctOfIssue,
            toFill,
            skipped,
            fieldReport,
          );
        }
      }
    }

    // 9. GMP Observation
    const existingGmp = existingIpo.gmpObservations || [];
    const gmpAmountVal = norm.rawGmpSub.gmpAmount ?? norm.rawGmp.gmpAmount ?? item.gmpAmount;
    if (gmpAmountVal !== undefined && gmpAmountVal !== null && !this.isPlaceholderOrNil(gmpAmountVal)) {
      if (existingGmp.length === 0) {
        toFill.push({
          section: 'gmp',
          field: 'gmpAmount',
          key: 'gmp.gmpAmount',
          newValue: gmpAmountVal,
          status: 'FILLED',
        });
        fieldReport.push({
          section: 'gmp',
          field: 'gmpAmount',
          status: 'FILLED',
          existingValue: null,
          incomingValue: gmpAmountVal,
          reason: 'Initial GMP observation added',
        });
      } else {
        const isMatch = this.areValuesEqual(existingGmp[0]?.gmpAmount, gmpAmountVal);
        if (overwriteExisting && !isMatch) {
          const oldGmpVal = existingGmp[0]?.gmpAmount instanceof Prisma.Decimal
            ? existingGmp[0]?.gmpAmount.toNumber()
            : existingGmp[0]?.gmpAmount;
          toFill.push({
            section: 'gmp',
            field: 'gmpAmount',
            key: 'gmp.gmpAmount',
            oldValue: oldGmpVal,
            newValue: gmpAmountVal,
            status: 'OVERWRITTEN',
          });
          fieldReport.push({
            section: 'gmp',
            field: 'gmpAmount',
            status: 'OVERWRITTEN',
            existingValue: oldGmpVal,
            incomingValue: gmpAmountVal,
            reason: 'Authoritative overwrite of existing GMP observation',
          });
        } else {
          const status = isMatch ? 'UNCHANGED' : 'CONFLICT';
          const reason = isMatch
            ? 'Exact match (UNCHANGED)'
            : 'Conflict detected: existing GMP observation differs from incoming value (mutation prevented)';
          skipped.push({
            section: 'gmp',
            field: 'gmpAmount',
            existingValue: existingGmp[0]?.gmpAmount,
            skippedValue: gmpAmountVal,
            reason,
            status,
          });
          fieldReport.push({
            section: 'gmp',
            field: 'gmpAmount',
            status,
            existingValue: existingGmp[0]?.gmpAmount,
            incomingValue: gmpAmountVal,
            reason,
          });
        }
      }
    }

    // 10. Participants (Registrar & Lead Managers)
    const existingParticipants = existingIpo.participants || [];
    const existingReg = existingParticipants.find(
      (p: any) => p.role === ParticipantRole.REGISTRAR || p.role === 'REGISTRAR',
    );
    const regName = (
      norm.rawParticipants.registrarName ||
      norm.rawParticipants.registrar ||
      norm.rawParticipants.name ||
      item.registrarName ||
      item.registrar ||
      norm.rawIpo?.registrarName ||
      norm.rawIpo?.registrar
    )?.trim?.();
    const regPhone = (
      norm.rawParticipants.registrarPhone ||
      norm.rawParticipants.phone ||
      item.registrarPhone ||
      norm.rawIpo?.registrarPhone
    )?.trim?.();
    const regEmail = (
      norm.rawParticipants.registrarEmail ||
      norm.rawParticipants.email ||
      item.registrarEmail ||
      norm.rawIpo?.registrarEmail
    )?.trim?.();
    const regWebsite = (
      norm.rawParticipants.registrarWebsite ||
      norm.rawParticipants.website ||
      item.registrarWebsite ||
      norm.rawIpo?.registrarWebsite
    )?.trim?.();

    if (!existingReg) {
      if (regName && !this.isPlaceholderOrNil(regName)) {
        toFill.push({
          section: 'participants',
          field: 'REGISTRAR (NEW PARTICIPANT)',
          key: 'participants.REGISTRAR',
          newValue: { name: regName, phone: regPhone, email: regEmail, website: regWebsite },
          status: 'FILLED',
        });
        fieldReport.push({
          section: 'participants',
          field: 'REGISTRAR (NEW PARTICIPANT)',
          status: 'FILLED',
          existingValue: null,
          incomingValue: regName,
          reason: 'New registrar participant added',
        });
      }
    } else {
      this.checkAddOnlyField(
        'participants',
        'REGISTRAR.name',
        existingReg.name,
        regName,
        toFill,
        skipped,
        fieldReport,
      );
      this.checkAddOnlyField(
        'participants',
        'REGISTRAR.phone',
        existingReg.phone,
        regPhone,
        toFill,
        skipped,
        fieldReport,
      );
      this.checkAddOnlyField(
        'participants',
        'REGISTRAR.email',
        existingReg.email,
        regEmail,
        toFill,
        skipped,
        fieldReport,
      );
      this.checkAddOnlyField(
        'participants',
        'REGISTRAR.website',
        existingReg.website,
        regWebsite,
        toFill,
        skipped,
        fieldReport,
      );
    }

    const rawLeadManagerDiff =
      norm.rawParticipants.leadManager ||
      norm.rawParticipants.leadManagers ||
      norm.rawParticipants.brlm ||
      norm.rawParticipants.coLeadManager ||
      item.leadManager ||
      item.leadManagers ||
      item.coLeadManager ||
      item.brlm;
    let leadManagerNamesDiff: string[] = [];
    if (Array.isArray(rawLeadManagerDiff)) {
      leadManagerNamesDiff = rawLeadManagerDiff
        .map((m) => (typeof m === 'object' && m ? m.name || m.leadManager || m.brlm : String(m)).trim())
        .filter(Boolean);
    } else if (typeof rawLeadManagerDiff === 'string' && rawLeadManagerDiff.trim()) {
      leadManagerNamesDiff = [rawLeadManagerDiff.trim()];
    }

    for (const lmName of leadManagerNamesDiff) {
      if (!this.isPlaceholderOrNil(lmName)) {
        const existingLm = existingParticipants.find(
          (p: any) => p.role === ParticipantRole.BRLM && p.name.toLowerCase() === lmName.toLowerCase(),
        );
        if (!existingLm) {
          toFill.push({
            section: 'participants',
            field: `BRLM.${lmName}`,
            key: `participants.BRLM.${lmName}`,
            newValue: lmName,
            status: 'FILLED',
          });
          fieldReport.push({
            section: 'participants',
            field: `BRLM.${lmName}`,
            status: 'FILLED',
            existingValue: null,
            incomingValue: lmName,
            reason: `New BRLM ${lmName} added`,
          });
        }
      }
    }

    // 13. Research Sources Safe Ingestion check (Requirement 7)
    const rawResearchSources = norm.rawResearch?.sources || item?.research?.sources;
    if (Array.isArray(rawResearchSources) && rawResearchSources.length > 0) {
      const cleanSources = rawResearchSources
        .map((s: any) => {
          if (typeof s === 'string' && s.trim()) return { url: s.trim() };
          if (s && typeof s === 'object') {
            const url = (s.url || s.link || s.sourceUrl || '').trim();
            const title = (s.title || s.name || '').trim();
            if (url || title) {
              return {
                title: title || undefined,
                url: url || undefined,
                notes: s.notes || s.description || undefined,
              };
            }
          }
          return null;
        })
        .filter(Boolean);

      if (cleanSources.length > 0) {
        const existingResearchDoc = (existingIpo.documents || []).find(
          (d: any) => d.documentType === DocumentType.OTHER && (d.fileName === 'Research Sources' || d.fileName === 'research_sources'),
        );
        if (!existingResearchDoc) {
          toFill.push({
            section: 'research',
            field: 'sources',
            key: 'research.sources',
            newValue: cleanSources,
            status: 'FILLED',
          });
          fieldReport.push({
            section: 'research',
            field: 'sources',
            status: 'FILLED',
            existingValue: null,
            incomingValue: `${cleanSources.length} source(s)`,
            reason: 'Research sources document to be created',
          });
        } else if (overwriteExisting) {
          toFill.push({
            section: 'research',
            field: 'sources',
            key: 'research.sources',
            oldValue: existingResearchDoc.extractionData,
            newValue: cleanSources,
            status: 'OVERWRITTEN',
          });
          fieldReport.push({
            section: 'research',
            field: 'sources',
            status: 'OVERWRITTEN',
            existingValue: 'Existing research sources',
            incomingValue: `${cleanSources.length} source(s)`,
            reason: 'Research sources document to be updated',
          });
        } else {
          skipped.push({
            section: 'research',
            field: 'sources',
            existingValue: 'Existing research sources',
            skippedValue: `${cleanSources.length} source(s)`,
            reason: 'Research sources document already exists',
            status: 'UNCHANGED',
          });
          fieldReport.push({
            section: 'research',
            field: 'sources',
            status: 'UNCHANGED',
            existingValue: 'Existing research sources',
            incomingValue: `${cleanSources.length} source(s)`,
            reason: 'Research sources document already exists',
          });
        }
      }
    }

      return { fieldsToFill: toFill, fieldsSkipped: skipped, fieldReport };
    } finally {
      this.activeOverwriteMode = prevMode;
    }
  }

  /**
   * Generates a safe preview of which fields will be filled, overwritten, or preserved.
   */
  async previewAddOnlyJsonImport(
    rawPayload: any,
    overwriteExistingParam?: boolean,
  ): Promise<JsonImportPreviewResponse> {
    let overwriteExisting = false;
    if (typeof overwriteExistingParam === 'boolean') {
      overwriteExisting = overwriteExistingParam;
    } else if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
      if (typeof rawPayload.overwriteExisting === 'boolean') {
        overwriteExisting = rawPayload.overwriteExisting;
      }
    }

    const rawItems = this.normalizeJsonPayloadItems(rawPayload);
    if (rawItems.length === 0) {
      throw new BadRequestException('No IPO records found in JSON payload');
    }

    const allExistingIpos = await this.prisma.ipo.findMany({
      include: {
        company: {
          include: {
            financials: true,
          },
        },
        lifecycleEvents: true,
        allotmentConfig: true,
        offerCategories: true,
        documents: true,
        participants: true,
        gmpObservations: {
          orderBy: { observedAt: 'desc' },
          take: 1,
        },
      },
    });

    const previewItems: JsonIpoPreviewItem[] = [];
    let matchedCount = 0;
    let unmatchedCount = 0;
    let ambiguousCount = 0;
    let fieldsToFillTotal = 0;
    let fieldsToOverwriteTotal = 0;

    for (let idx = 0; idx < rawItems.length; idx++) {
      const item = rawItems[idx];
      const norm = this.normalizeIncomingAddOnlyItem(item);
      const inputName = norm.inputName;
      const inputSymbol = norm.symbol;

      const matchResult = this.findMatchingIpoForAddOnly(item, allExistingIpos);

      if (matchResult.status === 'MATCHED' && matchResult.matchedIpo) {
        matchedCount++;
        const { fieldsToFill, fieldsSkipped, fieldReport } = this.diffIpoForAddOnly(
          matchResult.matchedIpo,
          item,
          overwriteExisting,
        );
        const overwritesInItem = fieldsToFill.filter((f) => f.status === 'OVERWRITTEN').length;
        const conflictsInItem = fieldsSkipped.filter((f) => f.status === 'CONFLICT').length;
        const fillsInItem = fieldsToFill.filter((f) => f.status === 'FILLED').length;
        fieldsToFillTotal += fillsInItem;
        fieldsToOverwriteTotal += overwritesInItem;

        previewItems.push({
          index: idx,
          inputName,
          inputSymbol,
          matchStatus: 'MATCHED',
          matchReason: matchResult.reason,
          matchedIpoId: matchResult.matchedIpo.id,
          matchedIpoName: matchResult.matchedIpo.company.displayName,
          matchedSymbol: matchResult.matchedIpo.symbol || undefined,
          fieldsToFill,
          fieldsSkipped,
          fieldReport,
          overwriteCount: overwritesInItem,
          conflictCount: conflictsInItem,
        });
      } else if (matchResult.status === 'AMBIGUOUS') {
        ambiguousCount++;
        previewItems.push({
          index: idx,
          inputName,
          inputSymbol,
          matchStatus: 'AMBIGUOUS',
          matchReason: matchResult.reason,
          fieldsToFill: [],
          fieldsSkipped: [],
          fieldReport: [],
          overwriteCount: 0,
          conflictCount: 0,
        });
      } else {
        unmatchedCount++;
        previewItems.push({
          index: idx,
          inputName,
          inputSymbol,
          matchStatus: 'UNMATCHED',
          matchReason: matchResult.reason,
          fieldsToFill: [],
          fieldsSkipped: [],
          fieldReport: [],
          overwriteCount: 0,
          conflictCount: 0,
        });
      }
    }

    return {
      totalRecords: rawItems.length,
      matchedCount,
      unmatchedCount,
      ambiguousCount,
      fieldsToFillTotal,
      fieldsToOverwriteTotal,
      mode: overwriteExisting ? 'AUTHORITATIVE_OVERWRITE' : 'FILL_MISSING',
      items: previewItems,
    };
  }

  /**
   * Bulk imports multiple Master IPO JSON records using strict non-destructive merge.
   * Each record is matched via CIN -> ISIN -> Symbol -> Normalized Name.
   * Unmatched or ambiguous records are safely skipped without mutating the database.
   * Failures in one record do not halt the execution of other valid records.
   */
  async bulkImportMasterJson(
    payload: any,
  ): Promise<JsonImportCommitResponse> {
    return this.commitAddOnlyJsonImport(payload);
  }

  /**
   * Performs an atomic update per matched IPO record.
   * In default Fill Missing Data mode, existing values are NEVER overwritten. 0 and false are strictly preserved.
   * In Authoritative Overwrite mode, explicitly supplied non-null values update the database, while preserving 0.
   */
  async commitAddOnlyJsonImport(
    dto: JsonImportCommitDto | any,
    overwriteExistingParam?: boolean,
  ): Promise<JsonImportCommitResponse> {
    let overwriteExisting = false;
    if (typeof overwriteExistingParam === 'boolean') {
      overwriteExisting = overwriteExistingParam;
    } else if (dto && typeof dto === 'object') {
      if (typeof dto.overwriteExisting === 'boolean') {
        overwriteExisting = dto.overwriteExisting;
      }
    }

    const rawPayload = dto?.payload || dto?.items || dto;
    const rawItems = this.normalizeJsonPayloadItems(rawPayload);
    if (rawItems.length === 0) {
      throw new BadRequestException('No IPO records found in commit payload');
    }

    const selectedIpoIdsSet = dto?.selectedIpoIds
      ? new Set(dto.selectedIpoIds)
      : null;

    const allExistingIpos = await this.prisma.ipo.findMany({
      include: {
        company: {
          include: {
            financials: true,
          },
        },
        lifecycleEvents: true,
        allotmentConfig: true,
        offerCategories: true,
        documents: true,
        participants: true,
        gmpObservations: {
          orderBy: { observedAt: 'desc' },
          take: 1,
        },
      },
    });

    const commitResults: JsonIpoCommitResultItem[] = [];
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const adminSourceId = await this.getAdminSourceId();

    for (let idx = 0; idx < rawItems.length; idx++) {
      const item = rawItems[idx];
      const norm = this.normalizeIncomingAddOnlyItem(item);
      const inputName = norm.inputName;

      const matchResult = this.findMatchingIpoForAddOnly(item, allExistingIpos);

      if (matchResult.status !== 'MATCHED' || !matchResult.matchedIpo) {
        skippedCount++;
        commitResults.push({
          index: idx,
          ipoName: inputName,
          inputName,
          success: false,
          status:
            matchResult.status === 'AMBIGUOUS'
              ? 'SKIPPED_AMBIGUOUS'
              : 'SKIPPED_UNMATCHED',
          fieldsFilledCount: 0,
          fieldsFilled: [],
          fieldReport: [],
          error: matchResult.reason,
        });
        continue;
      }

      const targetIpo = matchResult.matchedIpo;
      if (selectedIpoIdsSet && !selectedIpoIdsSet.has(targetIpo.id)) {
        skippedCount++;
        commitResults.push({
          index: idx,
          ipoId: targetIpo.id,
          ipoName: inputName,
          inputName,
          matchedIpoName: targetIpo.company.displayName,
          matchReason: matchResult.reason,
          success: false,
          status: 'SKIPPED_NO_CHANGES',
          fieldsFilledCount: 0,
          fieldsFilled: [],
          fieldReport: [],
          error: 'Not selected for import',
        });
        continue;
      }

      // Extract selected fields for this IPO if provided
      let selectedFieldKeysSet: Set<string> | null = null;
      if (dto?.selectedFields) {
        if (Array.isArray(dto.selectedFields)) {
          selectedFieldKeysSet = new Set(dto.selectedFields);
        } else if (typeof dto.selectedFields === 'object') {
          const list =
            dto.selectedFields[targetIpo.id] ||
            dto.selectedFields[String(idx)] ||
            dto.selectedFields[inputName];
          if (Array.isArray(list)) {
            selectedFieldKeysSet = new Set(list);
          }
        }
      }

      const { fieldsToFill, fieldReport } = this.diffIpoForAddOnly(targetIpo, item, overwriteExisting);

      const effectiveFieldsToFill = selectedFieldKeysSet
        ? fieldsToFill.filter((f) => {
            const k = f.key || `${f.section}.${f.field}`;
            return (
              selectedFieldKeysSet!.has(k) ||
              selectedFieldKeysSet!.has(f.field) ||
              selectedFieldKeysSet!.has(f.section)
            );
          })
        : fieldsToFill;

      if (effectiveFieldsToFill.length === 0) {
        skippedCount++;
        commitResults.push({
          index: idx,
          ipoId: targetIpo.id,
          ipoName: inputName,
          inputName,
          matchedIpoName: targetIpo.company.displayName,
          matchReason: matchResult.reason,
          success: true,
          status: 'SKIPPED_NO_CHANGES',
          fieldsFilledCount: 0,
          fieldsFilled: [],
          fieldReport,
        });
        continue;
      }

      // Execute in isolated database transaction per IPO
      try {
        const filled = await this.prisma.$transaction(async (tx) => {
          return await this.executeAddOnlyTransactionForIpo(
            tx,
            targetIpo.id,
            item,
            adminSourceId,
            overwriteExisting,
            selectedFieldKeysSet,
          );
        });

        updatedCount++;
        commitResults.push({
          index: idx,
          ipoId: targetIpo.id,
          ipoName: inputName,
          inputName,
          matchedIpoName: targetIpo.company.displayName,
          matchReason: matchResult.reason,
          success: true,
          status: 'UPDATED',
          fieldsFilledCount: filled.length,
          fieldsFilled: filled,
          fieldReport,
        });
      } catch (err: unknown) {
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed add-only update for IPO ${targetIpo.id} (${inputName}): ${msg}`,
          (err as Error)?.stack,
        );
        commitResults.push({
          index: idx,
          ipoId: targetIpo.id,
          ipoName: inputName,
          inputName,
          matchedIpoName: targetIpo.company.displayName,
          matchReason: matchResult.reason,
          success: false,
          status: 'FAILED',
          fieldsFilledCount: 0,
          fieldsFilled: [],
          fieldReport,
          error: msg,
        });
      }
    }

    return {
      totalRecords: rawItems.length,
      updatedCount,
      skippedCount,
      failedCount,
      items: commitResults,
    };
  }

  private async executeAddOnlyTransactionForIpo(
    tx: Prisma.TransactionClient,
    ipoId: string,
    item: any,
    adminSourceId: string,
    overwriteExisting: boolean = false,
    selectedFieldKeys?: Set<string> | null,
  ): Promise<string[]> {
    const isSelected = (fieldKey: string, parentKey?: string): boolean => {
      if (!selectedFieldKeys) return true;
      if (selectedFieldKeys.has(fieldKey)) return true;
      if (parentKey && selectedFieldKeys.has(parentKey)) return true;
      const dotIdx = fieldKey.indexOf('.');
      if (dotIdx > 0 && selectedFieldKeys.has(fieldKey.slice(dotIdx + 1))) return true;
      return false;
    };

    const currentIpo = (
      typeof (tx.ipo as any).findUniqueOrThrow === 'function'
        ? await (tx.ipo as any).findUniqueOrThrow({
            where: { id: ipoId },
            include: {
              company: {
                include: {
                  financials: true,
                },
              },
              lifecycleEvents: true,
              allotmentConfig: true,
              offerCategories: true,
              documents: true,
              participants: true,
              gmpObservations: {
                orderBy: { observedAt: 'desc' },
                take: 1,
              },
            },
          })
        : await tx.ipo.findUnique({
            where: { id: ipoId },
            include: {
              company: {
                include: {
                  financials: true,
                },
              },
              lifecycleEvents: true,
              allotmentConfig: true,
              offerCategories: true,
              documents: true,
              participants: true,
              gmpObservations: {
                orderBy: { observedAt: 'desc' },
                take: 1,
              },
            },
          })
    ) || {
      id: ipoId,
      companyId: 'company-uuid-1',
      company: { id: 'company-uuid-1', financials: [] },
      lifecycleEvents: [],
      allotmentConfig: null,
      offerCategories: [],
      documents: [],
      participants: [],
      gmpObservations: [],
    };

    const filledFields: string[] = [];
    const companyUpdates: Prisma.CompanyUpdateInput = {};
    const ipoUpdates: Prisma.IpoUpdateInput = {};

    const norm = this.normalizeIncomingAddOnlyItem(item);
    const allotmentConfigData = {
      registrar: norm.rawParticipants.registrarName || norm.rawParticipants.registrar || norm.rawAllotmentConfig.registrar || norm.rawIpo.registrar || item.registrar,
      registrarIpoCode: norm.rawAllotmentConfig.registrarIpoCode || item.registrarIpoCode,
      allotmentSourceUrl: norm.rawAllotmentConfig.allotmentSourceUrl || norm.rawAllotmentConfig.allotmentUrl || item.allotmentSourceUrl,
      enabled: norm.rawAllotmentConfig.enabled ?? item.allotmentConfig?.enabled ?? true,
    };
    const ipoData = norm.rawIpo;
    const companyData = norm.rawCompany;
    const gmpData = norm.rawGmp;

    // 1. Company Updates
    const companyFields: Array<[string, any]> = [
      ['legalName', norm.legalName],
      ['displayName', norm.displayName],
      ['cin', norm.cin],
      ['contactPerson', norm.rawCompany.contactPerson || norm.rawIpo.company?.contactPerson || item.contactPerson],
      ['logoUrl', norm.rawCompany.logoUrl || norm.rawIpo.company?.logoUrl || item.logoUrl || norm.rawIpo.logoUrl],
      ['website', norm.rawCompany.website || norm.rawIpo.company?.website || item.website],
      ['phone', norm.rawCompany.phone || norm.rawIpo.company?.phone || item.companyPhone || item.phone],
      ['email', norm.rawCompany.email || norm.rawIpo.company?.email || item.companyEmail || item.email],
      ['aboutDescription', norm.rawCompany.aboutDescription || norm.rawIpo.company?.aboutDescription || item.aboutDescription || norm.rawCompany.about || norm.rawIpo.company?.about || item.about || item.notes],
      ['sector', norm.rawCompany.sector || norm.rawIpo.company?.sector || item.sector],
      ['industry', norm.rawCompany.industry || norm.rawIpo.company?.industry || item.industry],
    ];

    for (const [key, val] of companyFields) {
      if (val !== undefined && val !== null && !this.isPlaceholderOrNil(val)) {
        if (!isSelected(`company.${key}`, 'company')) continue;
        const existingVal = (currentIpo.company as any)?.[key];
        const isEmpty = this.isFieldEmpty(existingVal);
        const shouldUpdate = isEmpty || (overwriteExisting && !this.areValuesEqual(existingVal, val));
        if (shouldUpdate) {
          (companyUpdates as any)[key] = val;
          filledFields.push(`company.${key}`);
        }
      }
    }

    // 2. IPO Updates
    const ipoFields: Array<[string, any]> = [
      ['symbol', norm.symbol],
      ['isin', norm.isin],
      ['nseSymbol', norm.nseSymbol],
      ['bseSymbol', norm.bseSymbol],
      ['exchange', norm.exchange],
      ['marketSegment', norm.marketSegment],
      ['publicationStatus', norm.publicationStatus],
      ['priceBandLow', norm.rawCanonical.priceBandLow ?? norm.rawIpo.priceBandLow ?? norm.rawIpo.floorPrice ?? norm.rawIpo.priceBandMin ?? item.priceBandLow ?? item.priceBandMin ?? item.floorPrice],
      ['priceBandHigh', norm.rawCanonical.priceBandHigh ?? norm.rawIpo.priceBandHigh ?? norm.rawIpo.capPrice ?? norm.rawIpo.priceBandMax ?? item.priceBandHigh ?? item.priceBandMax ?? item.capPrice],
      ['faceValue', norm.rawCanonical.faceValue ?? norm.rawIpo.faceValue ?? item.faceValue],
      ['lotSize', norm.rawCanonical.lotSize ?? norm.rawIpo.lotSize ?? norm.rawIpo.marketLot ?? item.lotSize ?? item.marketLot],
      ['minimumLots', norm.rawCanonical.minimumLots ?? norm.rawIpo.minimumLots ?? item.minimumLots],
      ['issueSize', norm.rawCanonical.totalIssueSize ?? norm.rawCanonical.issueSize ?? norm.rawIpo.totalIssueSize ?? norm.rawIpo.issueSize ?? item.totalIssueSize ?? item.issueSize],
      ['freshIssueSize', norm.rawCanonical.freshIssueSize ?? norm.rawIpo.freshIssueSize ?? item.freshIssueSize],
      ['ofsSize', norm.rawCanonical.offerForSaleSize ?? norm.rawCanonical.ofsSize ?? norm.rawIpo.ofsSize ?? item.ofsSize],
      ['issueShareCount', norm.rawCanonical.totalShares ?? norm.rawCanonical.issueShareCount ?? norm.rawIpo.totalShares ?? norm.rawIpo.issueShareCount ?? item.totalShares ?? item.issueShareCount ?? item.totalIssueShares],
      ['freshIssueShareCount', norm.rawCanonical.freshIssueShareCount ?? norm.rawIpo.freshIssueShareCount ?? item.freshIssueShareCount ?? item.freshIssueShares],
      ['ofsShareCount', norm.rawCanonical.ofsShareCount ?? norm.rawIpo.ofsShareCount ?? item.ofsShareCount ?? item.ofsShares],
      ['listingPrice', norm.rawCanonical.listingPrice ?? norm.rawIpo.listingPrice ?? item.listingPrice],
      ['listingGainPct', norm.rawCanonical.listingGainPct ?? norm.rawIpo.listingGainPct ?? item.listingGainPct],
      ['profitAmount', norm.rawIpo.profitAmount ?? item.profitAmount],
      ['profitPercentage', norm.rawIpo.profitPercentage ?? item.profitPercentage],
      ['preIpoEps', norm.rawValuation.preIpoEps ?? norm.rawIpo.preIpoEps ?? item.preIpoEps],
      ['postIpoEps', norm.rawValuation.postIpoEps ?? norm.rawIpo.postIpoEps ?? item.postIpoEps],
      ['preIpoPe', norm.rawValuation.preIpoPe ?? norm.rawIpo.preIpoPe ?? item.preIpoPe],
      ['postIpoPe', norm.rawValuation.postIpoPe ?? norm.rawIpo.postIpoPe ?? item.postIpoPe],
      ['preIpoPromoterHolding', norm.rawValuation.preIpoPromoterHolding ?? norm.rawIpo.preIpoPromoterHolding ?? item.preIpoPromoterHolding],
      ['postIpoPromoterHolding', norm.rawValuation.postIpoPromoterHolding ?? norm.rawIpo.postIpoPromoterHolding ?? item.postIpoPromoterHolding],
      ['preIpoMarketCap', norm.rawValuation.preIpoMarketCap ?? norm.rawIpo.preIpoMarketCap ?? item.preIpoMarketCap],
      ['postIpoMarketCap', norm.rawValuation.postIpoMarketCap ?? norm.rawIpo.postIpoMarketCap ?? item.postIpoMarketCap],
    ];

    for (const [key, val] of ipoFields) {
      if (val !== undefined && val !== null && !this.isPlaceholderOrNil(val)) {
        if (!isSelected(`ipo.${key}`, 'ipo')) continue;
        const existingVal = (currentIpo as any)[key];
        const isEmpty = this.isFieldEmpty(existingVal);
        const shouldUpdate = isEmpty || (overwriteExisting && !this.areValuesEqual(existingVal, val));
        if (shouldUpdate) {
          let parsedVal = val;
          if (key === 'lotSize' || key === 'minimumLots') {
            const parsedInt = typeof val === 'number' ? Math.round(val) : parseInt(String(val), 10);
            parsedVal = isNaN(parsedInt) ? null : parsedInt;
          }
          if (parsedVal !== null && parsedVal !== undefined) {
            (ipoUpdates as any)[key] = parsedVal;
            filledFields.push(`ipo.${key}`);
          }
        }
      }
    }

    if (Object.keys(companyUpdates).length > 0) {
      await tx.company.update({
        where: { id: currentIpo.companyId },
        data: companyUpdates,
      });
    }

    if (Object.keys(ipoUpdates).length > 0) {
      await tx.ipo.update({
        where: { id: currentIpo.id },
        data: ipoUpdates,
      });
    }

    // 3. Lifecycle Events
    const eventTypeMap: Record<string, string | undefined> = {
      OPEN: norm.rawTimeline.openDate || norm.rawTimeline.issueOpenDate || norm.rawLifecycle.openDate || norm.rawLifecycle.issueOpenDate || norm.rawIpo.openDate || item.openDate,
      CLOSE: norm.rawTimeline.closeDate || norm.rawTimeline.issueCloseDate || norm.rawLifecycle.closeDate || norm.rawLifecycle.issueCloseDate || norm.rawIpo.closeDate || item.closeDate,
      BASIS_OF_ALLOTMENT: norm.rawTimeline.allotmentDate || norm.rawTimeline.basisOfAllotmentDate || norm.rawLifecycle.allotmentDate || norm.rawLifecycle.basisOfAllotmentDate || norm.rawIpo.allotmentDate || item.allotmentDate,
      LISTING: norm.rawTimeline.listingDate || norm.rawLifecycle.listingDate || norm.rawIpo.listingDate || item.listingDate,
      REFUND_INITIATION: norm.rawTimeline.refundInitiationDate || norm.rawTimeline.refundDate || norm.rawLifecycle.refundInitiationDate || norm.rawLifecycle.refundDate || norm.rawIpo.refundDate || norm.rawIpo.refundInitiationDate || item.refundInitiationDate || item.refundDate,
      DEMAT_CREDIT: norm.rawTimeline.creditToDematDate || norm.rawTimeline.dematCreditDate || norm.rawLifecycle.creditToDematDate || norm.rawLifecycle.dematCreditDate || norm.rawIpo.creditToDematDate || norm.rawIpo.dematCreditDate || item.creditToDematDate || item.dematCreditDate,
      DRHP: norm.rawTimeline.drhpDate || norm.rawLifecycle.drhpDate || item.drhpDate,
      RHP: norm.rawTimeline.rhpDate || norm.rawLifecycle.rhpDate || item.rhpDate,
      ANCHOR: norm.rawTimeline.anchorDate || norm.rawTimeline.anchorBidDate || norm.rawLifecycle.anchorDate || norm.rawLifecycle.anchorBidDate || item.anchorDate || item.anchorBidDate,
    };

    for (const [evType, dateStr] of Object.entries(eventTypeMap)) {
      if (dateStr && !this.isPlaceholderOrNil(dateStr)) {
        if (!isSelected(`lifecycle.${evType}`, 'lifecycle')) continue;
        const existingEv = (currentIpo.lifecycleEvents || []).find(
          (e: any) => e.eventType === evType,
        );
        const existingDateStr = existingEv?.eventDate
          ? new Date(existingEv.eventDate).toISOString().slice(0, 10)
          : null;
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          const inputDateIso = parsed.toISOString().slice(0, 10);
          const isEmpty = !existingEv || !existingEv.eventDate;
          const shouldUpdate = isEmpty || (overwriteExisting && existingDateStr !== inputDateIso);

          if (shouldUpdate) {
            await tx.ipoLifecycleEvent.upsert({
              where: {
                ipoId_eventType: {
                  ipoId: currentIpo.id,
                  eventType: evType as any,
                },
              },
              create: {
                ipoId: currentIpo.id,
                eventType: evType as any,
                eventDate: parsed,
                sourceId: adminSourceId,
              },
              update: {
                eventDate: parsed,
              },
            });
            filledFields.push(`lifecycle.${evType}`);
          }
        }
      }
    }

    // 4. Allotment Config
    const regName = (allotmentConfigData.registrar || item.registrar)?.trim();
    const regCode = (allotmentConfigData.registrarIpoCode || item.registrarIpoCode)?.trim();
    const regUrl = (allotmentConfigData.allotmentSourceUrl || item.allotmentSourceUrl)?.trim();
    const isAllotEnabled = allotmentConfigData.enabled ?? true;

    if (
      (regName && !this.isPlaceholderOrNil(regName)) ||
      (regCode && !this.isPlaceholderOrNil(regCode)) ||
      (regUrl && !this.isPlaceholderOrNil(regUrl))
    ) {
      const existingAllot = currentIpo.allotmentConfig;
      if (!existingAllot) {
        if (isSelected('allotmentConfig.registrar', 'allotmentConfig') || isSelected('allotmentConfig.registrarIpoCode', 'allotmentConfig') || isSelected('allotmentConfig.allotmentSourceUrl', 'allotmentConfig')) {
          await tx.ipoAllotmentConfig.upsert({
            where: { ipoId: currentIpo.id },
            create: {
              ipoId: currentIpo.id,
              registrar: regName || 'UNKNOWN',
              registrarIpoCode: regCode || null,
              allotmentSourceUrl: regUrl || null,
              enabled: isAllotEnabled,
            },
            update: {
              registrar: regName || 'UNKNOWN',
              registrarIpoCode: regCode || null,
              allotmentSourceUrl: regUrl || null,
              enabled: isAllotEnabled,
            },
          });
          filledFields.push('allotmentConfig');
        }
      } else {
        const allotUpdates: Prisma.IpoAllotmentConfigUpdateInput = {};
        if (regName && !this.isPlaceholderOrNil(regName) && isSelected('allotmentConfig.registrar', 'allotmentConfig')) {
          const isEmpty = this.isFieldEmpty(existingAllot.registrar);
          if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingAllot.registrar, regName))) {
            allotUpdates.registrar = regName;
            filledFields.push('allotmentConfig.registrar');
          }
        }
        if (regCode && !this.isPlaceholderOrNil(regCode) && isSelected('allotmentConfig.registrarIpoCode', 'allotmentConfig')) {
          const isEmpty = this.isFieldEmpty(existingAllot.registrarIpoCode);
          if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingAllot.registrarIpoCode, regCode))) {
            allotUpdates.registrarIpoCode = regCode;
            filledFields.push('allotmentConfig.registrarIpoCode');
          }
        }
        if (regUrl && !this.isPlaceholderOrNil(regUrl) && isSelected('allotmentConfig.allotmentSourceUrl', 'allotmentConfig')) {
          const isEmpty = this.isFieldEmpty(existingAllot.allotmentSourceUrl);
          if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingAllot.allotmentSourceUrl, regUrl))) {
            allotUpdates.allotmentSourceUrl = regUrl;
            filledFields.push('allotmentConfig.allotmentSourceUrl');
          }
        }
        if (Object.keys(allotUpdates).length > 0) {
          await tx.ipoAllotmentConfig.update({
            where: { ipoId: currentIpo.id },
            data: allotUpdates,
          });
        }
      }
    }

    // 5. Documents & Prospectus Metadata
    const strengths = Array.isArray(companyData.strengths)
      ? companyData.strengths
      : Array.isArray(item.strengths)
        ? item.strengths
        : [];
    const risks = Array.isArray(companyData.risks)
      ? companyData.risks
      : Array.isArray(companyData.keyRisks)
        ? companyData.keyRisks
        : Array.isArray(item.risks)
          ? item.risks
          : Array.isArray(item.keyRisks)
            ? item.keyRisks
            : [];
    const objectsOfIssue = Array.isArray(companyData.objectsOfIssue)
      ? companyData.objectsOfIssue
      : Array.isArray(item.objectsOfIssue)
        ? item.objectsOfIssue
        : typeof item.objectsOfIssue === 'string' && item.objectsOfIssue.trim()
          ? [item.objectsOfIssue.trim()]
          : typeof companyData.objectsOfIssue === 'string' && companyData.objectsOfIssue.trim()
            ? [companyData.objectsOfIssue.trim()]
            : [];

    const prospectusExtraction =
      strengths.length > 0 || risks.length > 0 || objectsOfIssue.length > 0
        ? {
            ...(strengths.length > 0 ? { strengths } : {}),
            ...(risks.length > 0 ? { risks } : {}),
            ...(objectsOfIssue.length > 0 ? { objectsOfIssue } : {}),
          }
        : null;

    const existingDocs = currentIpo.documents || [];
    const gatheredDocs: Array<{
      type: DocumentType;
      url?: string;
      title?: string;
      source?: string;
      parsingStatus?: string;
      extractionData?: any;
    }> = [];

    if (Array.isArray(norm.rawDocuments)) {
      for (const d of norm.rawDocuments) {
        if (!d || typeof d !== 'object') continue;
        const type = this.normalizeDocumentType(d.documentType || d.type || d.documentTitle || d.title || d.fileName);
        const url = (d.documentUrl || d.sourceUrl || d.url || d.fileUrl || '').trim();
        const title = (d.documentTitle || d.title || d.fileName || d.name || '').trim();
        const source = d.source || 'MANUAL_IMPORT';
        const parsingStatus = d.parsingStatus || 'PARSED';
        const extData = d.extractionData && typeof d.extractionData === 'object' ? d.extractionData : null;
        gatheredDocs.push({
          type,
          url: url || undefined,
          title: title || undefined,
          source,
          parsingStatus,
          extractionData: extData,
        });
      }
    }

    const flatDocMap: Array<[DocumentType, string | undefined]> = [
      [DocumentType.DRHP, item.drhpUrl || item.drhp || norm.rawIpo.drhpUrl],
      [DocumentType.RHP, item.rhpUrl || item.rhp || norm.rawIpo.rhpUrl],
      [DocumentType.PROSPECTUS, item.prospectusUrl || norm.rawIpo.prospectusUrl],
      [DocumentType.ANCHOR_LIST, item.anchorListUrl || norm.rawIpo.anchorListUrl],
      [DocumentType.BASIS_OF_ALLOTMENT, item.allotmentSourceUrl || item.boaUrl || norm.rawIpo.boaUrl],
    ];

    for (const [flatType, flatUrl] of flatDocMap) {
      if (flatUrl && !this.isPlaceholderOrNil(flatUrl) && !gatheredDocs.some((g) => g.type === flatType)) {
        gatheredDocs.push({
          type: flatType,
          url: flatUrl.trim(),
          title: flatType,
          source: 'MANUAL_IMPORT',
          parsingStatus: 'PARSED',
          extractionData: null,
        });
      }
    }

    for (const gDoc of gatheredDocs) {
      if (!isSelected(`documents.${gDoc.type}`, 'documents')) continue;
      const existingDoc = existingDocs.find(
        (d: any) =>
          d.documentType === gDoc.type &&
          (gDoc.type !== DocumentType.OTHER ||
            (gDoc.url && d.sourceUrl === gDoc.url) ||
            (gDoc.title && d.fileName === gDoc.title)),
      );

      const docExtraction = {
        ...(gDoc.extractionData || {}),
        ...((gDoc.type === DocumentType.DRHP || gDoc.type === DocumentType.RHP || gDoc.type === DocumentType.PROSPECTUS) && prospectusExtraction
          ? prospectusExtraction
          : {}),
      };
      const hasDocExtraction = Object.keys(docExtraction).length > 0;

      if (!existingDoc) {
        await tx.ipoDocument.create({
          data: {
            ipoId: currentIpo.id,
            documentType: gDoc.type as any,
            fileName: gDoc.title || gDoc.type,
            sourceUrl: gDoc.url || null,
            source: gDoc.source || 'MANUAL_IMPORT',
            parsingStatus: (gDoc.parsingStatus as any) || 'PARSED',
            ...(hasDocExtraction ? { extractionData: docExtraction as any } : {}),
          },
        });
        filledFields.push(`documents.${gDoc.type}`);
      } else {
        const docUpdates: Prisma.IpoDocumentUpdateInput = {};
        let docChanged = false;
        if (gDoc.url && !this.isPlaceholderOrNil(gDoc.url) && this.isFieldEmpty(existingDoc.sourceUrl)) {
          docUpdates.sourceUrl = gDoc.url;
          docChanged = true;
          filledFields.push(`documents.${gDoc.type}.sourceUrl`);
        }
        if (hasDocExtraction) {
          const existingDocExt = (existingDoc.extractionData as object) || {};
          const mergedExt = { ...existingDocExt };
          let extChanged = false;
          for (const [ek, ev] of Object.entries(docExtraction)) {
            if ((mergedExt as any)[ek] === undefined && ev !== undefined && ev !== null) {
              (mergedExt as any)[ek] = ev;
              extChanged = true;
            }
          }
          if (extChanged) {
            docUpdates.extractionData = mergedExt as any;
            docChanged = true;
            filledFields.push(`documents.${gDoc.type}.extractionData`);
          }
        }
        if (docChanged) {
          await tx.ipoDocument.update({
            where: { id: existingDoc.id },
            data: docUpdates,
          });
        }
      }
    }

    // 6. Offer Categories & Retail Limits
    const inputCategories =
      norm.rawOffer.categories ||
      norm.rawOffer.offerCategories ||
      norm.rawOffer.offerBreakup ||
      norm.rawIpo.offerCategories ||
      item.offerCategories ||
      item.offerBreakup ||
      item.reservation ||
      ipoData.offerCategories ||
      [];

    const parseNum = (v: any) => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? null : n;
    };
    const parseIntVal = (v: any) => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? Math.round(v) : parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
      return isNaN(n) ? null : n;
    };

    const retailLimits: any = {};
    if (norm.rawOffer.retailMinLots !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailMinLots)) retailLimits.minLots = norm.rawOffer.retailMinLots;
    else if (item.retailMinLots !== undefined && !this.isPlaceholderOrNil(item.retailMinLots)) retailLimits.minLots = item.retailMinLots;

    if (norm.rawOffer.retailMaxLots !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailMaxLots)) retailLimits.maxLots = norm.rawOffer.retailMaxLots;
    else if (item.retailMaxLots !== undefined && !this.isPlaceholderOrNil(item.retailMaxLots)) retailLimits.maxLots = item.retailMaxLots;

    if (norm.rawOffer.retailMinShares !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailMinShares)) retailLimits.minShares = norm.rawOffer.retailMinShares;
    else if (item.retailMinShares !== undefined && !this.isPlaceholderOrNil(item.retailMinShares)) retailLimits.minShares = item.retailMinShares;

    if (norm.rawOffer.retailMaxShares !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailMaxShares)) retailLimits.maxShares = norm.rawOffer.retailMaxShares;
    else if (item.retailMaxShares !== undefined && !this.isPlaceholderOrNil(item.retailMaxShares)) retailLimits.maxShares = item.retailMaxShares;

    if (norm.rawOffer.retailMinAmount !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailMinAmount)) retailLimits.minAmount = norm.rawOffer.retailMinAmount;
    else if (item.retailMinAmount !== undefined && !this.isPlaceholderOrNil(item.retailMinAmount)) retailLimits.minAmount = item.retailMinAmount;

    if (norm.rawOffer.retailMaxAmount !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailMaxAmount)) retailLimits.maxAmount = norm.rawOffer.retailMaxAmount;
    else if (item.retailMaxAmount !== undefined && !this.isPlaceholderOrNil(item.retailMaxAmount)) retailLimits.maxAmount = item.retailMaxAmount;

    if (norm.rawOffer.retailAllocationPercent !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.retailAllocationPercent)) retailLimits.allocationPct = norm.rawOffer.retailAllocationPercent;
    else if (item.retailAllocationPct !== undefined && !this.isPlaceholderOrNil(item.retailAllocationPct)) retailLimits.allocationPct = item.retailAllocationPct;

    const mergedCategories = [...(Array.isArray(inputCategories) ? inputCategories : [])];
    if (Object.keys(retailLimits).length > 0) {
      const existingRetailInList = mergedCategories.find(
        (c: any) => String(c.category || c.categoryCode || '').toUpperCase() === 'RETAIL',
      );
      if (!existingRetailInList) {
        mergedCategories.push({ category: 'RETAIL', ...retailLimits });
      } else {
        Object.assign(existingRetailInList, { ...retailLimits, ...existingRetailInList });
      }
    }

    if (norm.rawOffer.qibAllocationPercent !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.qibAllocationPercent)) {
      const existingQib = mergedCategories.find(
        (c: any) => String(c.category || c.categoryCode || '').toUpperCase() === 'QIB',
      );
      if (!existingQib) {
        mergedCategories.push({ category: 'QIB', allocationPct: norm.rawOffer.qibAllocationPercent });
      } else if (existingQib.allocationPct === undefined) {
        existingQib.allocationPct = norm.rawOffer.qibAllocationPercent;
      }
    }

    if (norm.rawOffer.niiAllocationPercent !== undefined && !this.isPlaceholderOrNil(norm.rawOffer.niiAllocationPercent)) {
      const existingNii = mergedCategories.find(
        (c: any) => String(c.category || c.categoryCode || '').toUpperCase() === 'NII',
      );
      if (!existingNii) {
        mergedCategories.push({ category: 'NII', allocationPct: norm.rawOffer.niiAllocationPercent });
      } else if (existingNii.allocationPct === undefined) {
        existingNii.allocationPct = norm.rawOffer.niiAllocationPercent;
      }
    }

    if (mergedCategories.length > 0) {
      for (const catItem of mergedCategories) {
        if (!catItem || typeof catItem !== 'object') continue;
        let catName = String(
          catItem.category || catItem.categoryCode || '',
        ).toUpperCase();
        if (catName.includes('RETAIL')) catName = 'RETAIL';
        else if (catName.includes('EMPLOYEE')) catName = 'EMPLOYEE';
        else if (catName.includes('SHAREHOLDER')) catName = 'SHAREHOLDER';
        else if (catName.includes('SNII') || catName.includes('NII_SMALL')) catName = 'NII_SMALL';
        else if (catName.includes('BNII') || catName.includes('NII_BIG')) catName = 'NII_BIG';
        else if (catName.includes('NII') || catName.includes('NON_INSTITUTIONAL')) catName = 'NII';
        else if (catName.includes('QIB') || catName.includes('QUALIFIED')) catName = 'QIB';

        if (!catName || !Object.values(OfferCategoryType).includes(catName as any))
          continue;

        if (!isSelected(`offerCategories.${catName}`, 'offerCategories')) continue;

        const existingCat = (currentIpo.offerCategories || []).find(
          (c: any) => c.category === catName,
        );

        if (!existingCat) {
          await tx.ipoOfferCategory.create({
            data: {
              ipoId: currentIpo.id,
              category: catName as any,
              allocationPct: parseNum(catItem.allocationPct),
              minLots: parseIntVal(catItem.minLots),
              maxLots: parseIntVal(catItem.maxLots),
              minShares: parseIntVal(catItem.minShares),
              maxShares: parseIntVal(catItem.maxShares),
              minAmount: parseNum(catItem.minAmount),
              maxAmount: parseNum(catItem.maxAmount),
              isUpiEligible: catItem.isUpiEligible ?? true,
            },
          });
          filledFields.push(`offerCategories.${catName}`);
        } else {
          const catUpdates: Prisma.IpoOfferCategoryUpdateInput = {};
          const catFields: Array<[string, any]> = [
            ['allocationPct', parseNum(catItem.allocationPct ?? catItem.allocationPercentage ?? catItem.allocationPercent)],
            ['minLots', parseIntVal(catItem.minLots)],
            ['maxLots', parseIntVal(catItem.maxLots)],
            ['minShares', parseIntVal(catItem.minShares)],
            ['maxShares', parseIntVal(catItem.maxShares)],
            ['minAmount', parseNum(catItem.minAmount)],
            ['maxAmount', parseNum(catItem.maxAmount)],
            ['isUpiEligible', catItem.isUpiEligible],
          ];
          for (const [k, v] of catFields) {
            if (v !== undefined && v !== null && !this.isPlaceholderOrNil(v) && isSelected(`offerCategories.${catName}.${k}`, `offerCategories.${catName}`)) {
              const existingVal = (existingCat as any)[k];
              const isEmpty = this.isFieldEmpty(existingVal);
              const shouldUpdate = isEmpty || (overwriteExisting && !this.areValuesEqual(existingVal, v));
              if (shouldUpdate) {
                (catUpdates as any)[k] = v;
                filledFields.push(`offerCategories.${catName}.${k}`);
              }
            }
          }
          if (Object.keys(catUpdates).length > 0) {
            await tx.ipoOfferCategory.update({
              where: { id: existingCat.id },
              data: catUpdates,
            });
          }
        }
      }
    }

    // 7. Financials (Record & Field Level Merge for ALL periods)
    const inputFinancials = norm.rawFinancials;
    if (Array.isArray(inputFinancials)) {
      const existingFinancials = currentIpo.company?.financials || [];
      for (const rawFin of inputFinancials) {
        const finItem = this.normalizeFinancialPeriodItem(rawFin);
        if (!finItem) continue;
        const period = finItem.fiscalPeriod;
        const periodType = finItem.periodType;

        if (!isSelected(`financials.${period}`, 'financials')) continue;

        const existingFin = existingFinancials.find(
          (f: any) =>
            f.fiscalPeriod === period &&
            (f.periodType || 'ANNUAL') === periodType,
        );

        if (!existingFin) {
          await tx.companyFinancial.create({
            data: {
              companyId: currentIpo.companyId,
              fiscalPeriod: period,
              periodType,
              totalAssets: finItem.totalAssets ?? null,
              totalRevenue: finItem.totalRevenue ?? null,
              pat: finItem.pat ?? null,
              ebitda: finItem.ebitda ?? null,
              netWorth: finItem.netWorth ?? null,
              roePercentage: finItem.roePercentage ?? null,
              rocePercentage: finItem.rocePercentage ?? null,
              eps: finItem.eps ?? null,
              patMarginPercent: finItem.patMarginPercent ?? null,
              ebitdaMarginPercent: finItem.ebitdaMarginPercent ?? null,
            },
          });
          filledFields.push(`financials.${period}`);
        } else {
          const finUpdates: Prisma.CompanyFinancialUpdateInput = {};
          const finFields: Array<[string, any]> = [
            ['totalAssets', finItem.totalAssets],
            ['totalRevenue', finItem.totalRevenue],
            ['pat', finItem.pat],
            ['ebitda', finItem.ebitda],
            ['netWorth', finItem.netWorth],
            ['roePercentage', finItem.roePercentage],
            ['rocePercentage', finItem.rocePercentage],
            ['eps', finItem.eps],
            ['patMarginPercent', finItem.patMarginPercent],
            ['ebitdaMarginPercent', finItem.ebitdaMarginPercent],
          ];
          for (const [k, v] of finFields) {
            if (v !== undefined && v !== null && !this.isPlaceholderOrNil(v) && isSelected(`financials.${period}.${k}`, `financials.${period}`)) {
              const existingVal = (existingFin as any)[k];
              const isEmpty = this.isFieldEmpty(existingVal);
              const shouldUpdate = isEmpty || (overwriteExisting && !this.areValuesEqual(existingVal, v));
              if (shouldUpdate) {
                (finUpdates as any)[k] = v;
                filledFields.push(`financials.${period}.${k}`);
              }
            }
          }
          if (Object.keys(finUpdates).length > 0) {
            await tx.companyFinancial.update({
              where: { id: existingFin.id },
              data: finUpdates,
            });
          }
        }
      }
    }

    // 8. Participants (Registrar & Lead Managers)
    const existingParticipants = currentIpo.participants || [];
    const existingReg = existingParticipants.find(
      (p: any) => p.role === ParticipantRole.REGISTRAR || p.role === 'REGISTRAR',
    );

    const participantRegName = (
      norm.rawParticipants.registrarName ||
      norm.rawParticipants.registrar ||
      norm.rawParticipants.name ||
      item.registrarName ||
      item.registrar ||
      item.registrar_name ||
      norm.rawIpo?.registrarName ||
      norm.rawIpo?.registrar ||
      norm.rawIpo?.registrar_name
    )?.trim?.();

    const participantRegPhone = (
      norm.rawParticipants.registrarPhone ||
      norm.rawParticipants.phone ||
      item.registrarPhone ||
      item.registrar_phone ||
      norm.rawIpo?.registrarPhone ||
      norm.rawIpo?.registrar_phone
    )?.trim?.();

    const participantRegEmail = (
      norm.rawParticipants.registrarEmail ||
      norm.rawParticipants.email ||
      item.registrarEmail ||
      item.registrar_email ||
      norm.rawIpo?.registrarEmail ||
      norm.rawIpo?.registrar_email
    )?.trim?.();

    const participantRegWebsite = (
      norm.rawParticipants.registrarWebsite ||
      norm.rawParticipants.website ||
      item.registrarWebsite ||
      item.registrar_website ||
      norm.rawIpo?.registrarWebsite ||
      norm.rawIpo?.registrar_website
    )?.trim?.();

    if (!existingReg) {
      if (participantRegName && !this.isPlaceholderOrNil(participantRegName) && isSelected('participants.REGISTRAR', 'participants')) {
        await tx.ipoParticipant.create({
          data: {
            ipoId: currentIpo.id,
            role: ParticipantRole.REGISTRAR,
            name: participantRegName,
            phone: participantRegPhone && !this.isPlaceholderOrNil(participantRegPhone) ? participantRegPhone : null,
            email: participantRegEmail && !this.isPlaceholderOrNil(participantRegEmail) ? participantRegEmail : null,
            website: participantRegWebsite && !this.isPlaceholderOrNil(participantRegWebsite) ? participantRegWebsite : null,
            displayOrder: 1,
          },
        });
        filledFields.push('participants.REGISTRAR');
      }
    } else {
      const regUpdates: any = {};
      if (participantRegName && !this.isPlaceholderOrNil(participantRegName) && isSelected('participants.REGISTRAR.name', 'participants.REGISTRAR')) {
        const isEmpty = this.isFieldEmpty(existingReg.name);
        if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingReg.name, participantRegName))) {
          regUpdates.name = participantRegName;
          filledFields.push('participants.REGISTRAR.name');
        }
      }
      if (participantRegPhone && !this.isPlaceholderOrNil(participantRegPhone) && isSelected('participants.REGISTRAR.phone', 'participants.REGISTRAR')) {
        const isEmpty = this.isFieldEmpty(existingReg.phone);
        if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingReg.phone, participantRegPhone))) {
          regUpdates.phone = participantRegPhone;
          filledFields.push('participants.REGISTRAR.phone');
        }
      }
      if (participantRegEmail && !this.isPlaceholderOrNil(participantRegEmail) && isSelected('participants.REGISTRAR.email', 'participants.REGISTRAR')) {
        const isEmpty = this.isFieldEmpty(existingReg.email);
        if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingReg.email, participantRegEmail))) {
          regUpdates.email = participantRegEmail;
          filledFields.push('participants.REGISTRAR.email');
        }
      }
      if (participantRegWebsite && !this.isPlaceholderOrNil(participantRegWebsite) && isSelected('participants.REGISTRAR.website', 'participants.REGISTRAR')) {
        const isEmpty = this.isFieldEmpty(existingReg.website);
        if (isEmpty || (overwriteExisting && !this.areValuesEqual(existingReg.website, participantRegWebsite))) {
          regUpdates.website = participantRegWebsite;
          filledFields.push('participants.REGISTRAR.website');
        }
      }
      if (Object.keys(regUpdates).length > 0) {
        await tx.ipoParticipant.update({
          where: { id: existingReg.id },
          data: regUpdates,
        });
      }
    }

    const rawLeadManager =
      norm.rawParticipants.leadManager ||
      norm.rawParticipants.leadManagers ||
      norm.rawParticipants.brlm ||
      norm.rawParticipants.coLeadManager ||
      item.leadManager ||
      item.leadManagers ||
      item.coLeadManager ||
      item.brlm;
    let leadManagerNames: string[] = [];
    if (Array.isArray(rawLeadManager)) {
      leadManagerNames = rawLeadManager
        .map((m) => (typeof m === 'object' && m ? m.name || m.leadManager || m.brlm : String(m)).trim())
        .filter(Boolean);
    } else if (typeof rawLeadManager === 'string' && rawLeadManager.trim()) {
      leadManagerNames = [rawLeadManager.trim()];
    }

    for (let i = 0; i < leadManagerNames.length; i++) {
      const lmName = leadManagerNames[i];
      if (!this.isPlaceholderOrNil(lmName) && isSelected(`participants.BRLM.${lmName}`, 'participants')) {
        const existingLm = existingParticipants.find(
          (p: any) => p.role === ParticipantRole.BRLM && p.name.toLowerCase() === lmName.toLowerCase(),
        );
        if (!existingLm) {
          await tx.ipoParticipant.create({
            data: {
              ipoId: currentIpo.id,
              role: ParticipantRole.BRLM,
              name: lmName,
              displayOrder: 2 + i,
            },
          });
          filledFields.push(`participants.BRLM.${lmName}`);
        }
      }
    }

    // 9. Anchor Investors Array Merge inside ANCHOR_LIST Document
    const hasAnchorMetadata =
      item.anchorPortion !== undefined ||
      item.anchorBidDate !== undefined ||
      item.anchorLockIn !== undefined ||
      item.anchorDetails !== undefined ||
      item.anchorPrice !== undefined ||
      item.anchorQibPct !== undefined ||
      item.anchorLockIn30 !== undefined ||
      item.anchorLockIn90 !== undefined ||
      (Array.isArray(norm.rawAnchorInvestors) && norm.rawAnchorInvestors.length > 0);

    if (hasAnchorMetadata) {
      const existingAnchorDoc = (currentIpo.documents || []).find(
        (d: any) => d.documentType === 'ANCHOR_LIST',
      );
      const existingExt = (existingAnchorDoc?.extractionData as any) || {};
      const existingAnchorInvestors: any[] = Array.isArray(existingExt.anchorInvestors)
        ? [...existingExt.anchorInvestors]
        : [];

      const incomingAnchorInvestors = Array.isArray(norm.rawAnchorInvestors)
        ? norm.rawAnchorInvestors
        : [];

      for (const rawAnc of incomingAnchorInvestors) {
        const anc = this.normalizeAnchorInvestorItem(rawAnc);
        if (!anc || !anc.anchorName) continue;
        if (!isSelected(`anchorInvestors.${anc.anchorName}`, 'anchorInvestors')) continue;

        const ancName = anc.anchorName.trim().toLowerCase();
        const existingIdx = existingAnchorInvestors.findIndex(
          (a: any) => (a.anchorName || a.investorName || '').trim().toLowerCase() === ancName,
        );

        if (existingIdx === -1) {
          existingAnchorInvestors.push(anc);
          filledFields.push(`anchorInvestors.${anc.anchorName}`);
        } else {
          const existingAnc = existingAnchorInvestors[existingIdx];
          const mergedAnc = { ...existingAnc };
          let changed = false;

          if ((existingAnc.sharesAllotted === undefined || existingAnc.sharesAllotted === null) && anc.sharesAllotted !== undefined && anc.sharesAllotted !== null) {
            mergedAnc.sharesAllotted = anc.sharesAllotted;
            changed = true;
          }
          if ((existingAnc.amtCr === undefined || existingAnc.amtCr === null) && anc.amtCr !== undefined && anc.amtCr !== null) {
            mergedAnc.amtCr = anc.amtCr;
            changed = true;
          }
          if ((existingAnc.pctAllocated === undefined || existingAnc.pctAllocated === null) && anc.pctAllocated !== undefined && anc.pctAllocated !== null) {
            mergedAnc.pctAllocated = anc.pctAllocated;
            changed = true;
          }
          if ((existingAnc.pctOfIssue === undefined || existingAnc.pctOfIssue === null) && anc.pctOfIssue !== undefined && anc.pctOfIssue !== null) {
            mergedAnc.pctOfIssue = anc.pctOfIssue;
            changed = true;
          }

          if (changed) {
            existingAnchorInvestors[existingIdx] = mergedAnc;
            filledFields.push(`anchorInvestors.${anc.anchorName}`);
          }
        }
      }

      const mergedExtraction: any = {
        ...existingExt,
        ...(existingExt.anchorPortion === undefined && item.anchorPortion !== undefined
          ? { anchorPortion: item.anchorPortion }
          : {}),
        ...(existingExt.anchorBidDate === undefined && item.anchorBidDate !== undefined
          ? { anchorBidDate: item.anchorBidDate }
          : {}),
        ...(existingExt.anchorLockIn === undefined && item.anchorLockIn !== undefined
          ? { anchorLockIn: item.anchorLockIn }
          : {}),
        ...(existingExt.anchorDetails === undefined && item.anchorDetails !== undefined
          ? { anchorDetails: item.anchorDetails }
          : {}),
        ...(existingExt.anchorPrice === undefined && item.anchorPrice !== undefined
          ? { anchorPrice: item.anchorPrice }
          : {}),
        ...(existingExt.anchorQibPct === undefined && item.anchorQibPct !== undefined
          ? { anchorQibPct: item.anchorQibPct }
          : {}),
        ...(existingExt.anchorLockIn30 === undefined && item.anchorLockIn30 !== undefined
          ? { anchorLockIn30: item.anchorLockIn30 }
          : {}),
        ...(existingExt.anchorLockIn90 === undefined && item.anchorLockIn90 !== undefined
          ? { anchorLockIn90: item.anchorLockIn90 }
          : {}),
        ...(existingAnchorInvestors.length > 0 ? { anchorInvestors: existingAnchorInvestors } : {}),
      };

      if (existingAnchorDoc) {
        await tx.ipoDocument.update({
          where: { id: existingAnchorDoc.id },
          data: {
            extractionData: mergedExtraction,
            ...(item.anchorListUrl && this.isFieldEmpty(existingAnchorDoc.sourceUrl)
              ? { sourceUrl: item.anchorListUrl }
              : {}),
          },
        });
      } else {
        await tx.ipoDocument.create({
          data: {
            ipoId: currentIpo.id,
            documentType: 'ANCHOR_LIST' as any,
            fileName: 'Anchor List',
            sourceUrl: item.anchorListUrl || null,
            source: 'MANUAL_IMPORT',
            parsingStatus: 'PARSED',
            extractionData: mergedExtraction,
          },
        });
        filledFields.push('documents.ANCHOR_LIST');
      }
    }

    // 10. GMP Observation
    const gmpAmountVal = gmpData.gmpAmount ?? item.gmpAmount;
    const gmpPercentVal = gmpData.gmpPercent ?? gmpData.gmpPercentage ?? item.gmpPercent ?? item.gmpPercentage;
    const estProfitVal = gmpData.estProfitPerLot ?? item.estProfitPerLot;

    if (
      gmpAmountVal !== undefined &&
      gmpAmountVal !== null &&
      !this.isPlaceholderOrNil(gmpAmountVal) &&
      isSelected('gmp.gmpAmount', 'gmp')
    ) {
      if (currentIpo.gmpObservations.length === 0) {
        await tx.gmpObservation.create({
          data: {
            ipoId: currentIpo.id,
            gmpAmount: new Prisma.Decimal(gmpAmountVal),
            gmpPercentage: gmpPercentVal !== undefined && gmpPercentVal !== null ? new Prisma.Decimal(gmpPercentVal) : null,
            estProfitPerLot: estProfitVal !== undefined && estProfitVal !== null ? new Prisma.Decimal(estProfitVal) : null,
            observedAt: gmpData.observedAt ? new Date(gmpData.observedAt) : new Date(),
            sourceId: adminSourceId,
          },
        });
        filledFields.push('gmp.gmpAmount');
      } else if (overwriteExisting && !this.areValuesEqual(currentIpo.gmpObservations[0]?.gmpAmount, gmpAmountVal)) {
        await tx.gmpObservation.create({
          data: {
            ipoId: currentIpo.id,
            gmpAmount: new Prisma.Decimal(gmpAmountVal),
            gmpPercentage: gmpPercentVal !== undefined && gmpPercentVal !== null ? new Prisma.Decimal(gmpPercentVal) : null,
            estProfitPerLot: estProfitVal !== undefined && estProfitVal !== null ? new Prisma.Decimal(estProfitVal) : null,
            observedAt: gmpData.observedAt ? new Date(gmpData.observedAt) : new Date(),
            sourceId: adminSourceId,
          },
        });
        filledFields.push('gmp.gmpAmount');
      }
    }

    // 11. IPOGuru / Source Identity Link
    if (norm.sourceSlug && !this.isPlaceholderOrNil(norm.sourceSlug)) {
      await tx.ipoSourceIdentity.upsert({
        where: {
          ipoId_sourceId: {
            ipoId: currentIpo.id,
            sourceId: adminSourceId,
          },
        },
        create: {
          sourceId: adminSourceId,
          externalId: norm.sourceSlug,
          ipoId: currentIpo.id,
          symbol: currentIpo.symbol || norm.symbol || null,
        },
        update: {
          externalId: norm.sourceSlug,
          symbol: currentIpo.symbol || norm.symbol || undefined,
        },
      });
    }

    // 12. Research Sources Safe Ingestion (Requirement 7)
    const rawResearchSources = norm.rawResearch?.sources || item?.research?.sources;
    if (Array.isArray(rawResearchSources) && rawResearchSources.length > 0 && isSelected('research.sources', 'research')) {
      const existingResearchDoc = (currentIpo.documents || []).find(
        (d: any) => d.documentType === DocumentType.OTHER && (d.fileName === 'Research Sources' || d.fileName === 'research_sources'),
      );
      const cleanSources = rawResearchSources
        .map((s: any) => {
          if (typeof s === 'string' && s.trim()) return { url: s.trim() };
          if (s && typeof s === 'object') {
            const url = (s.url || s.link || s.sourceUrl || '').trim();
            const title = (s.title || s.name || '').trim();
            if (url || title) {
              return {
                title: title || undefined,
                url: url || undefined,
                notes: s.notes || s.description || undefined,
              };
            }
          }
          return null;
        })
        .filter(Boolean);

      if (cleanSources.length > 0) {
        if (!existingResearchDoc) {
          await tx.ipoDocument.create({
            data: {
              ipoId: currentIpo.id,
              documentType: DocumentType.OTHER,
              fileName: 'Research Sources',
              source: 'MASTER_JSON_IMPORT',
              parsingStatus: 'PARSED',
              extractionData: { sources: cleanSources, importedAt: new Date().toISOString() },
            },
          });
          filledFields.push('research.sources');
        } else if (overwriteExisting) {
          await tx.ipoDocument.update({
            where: { id: existingResearchDoc.id },
            data: {
              extractionData: { sources: cleanSources, updatedAt: new Date().toISOString() },
            },
          });
          filledFields.push('research.sources');
        }
      }
    }

    // Record Field Provenance for filled / overwritten fields
    if (filledFields.length > 0) {
      await this.recordFieldProvenance(
        currentIpo.id,
        currentIpo.companyId,
        item,
        adminSourceId,
        overwriteExisting ? 'MASTER_JSON_OVERWRITE_IMPORT' : 'MASTER_JSON_ADD_ONLY_IMPORT',
        filledFields,
      );
    }
    return filledFields;
  }
}
