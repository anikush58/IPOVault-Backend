import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
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
import { normalizeName } from '../allotment/allotment.matching';
import {
  AdminIpoQueryDto,
  ConfigureAllotmentDto,
  CreateAdminIpoDto,
  FieldDiffSkipped,
  FieldDiffToFill,
  JsonImportCommitDto,
  JsonImportCommitResponse,
  JsonImportPreviewResponse,
  JsonIpoCommitResultItem,
  JsonIpoPreviewItem,
  UpdateAdminIpoDto,
} from './admin-ipo.dto';
import { AdminValidationService } from './admin-validation.service';

@Injectable()
export class AdminIpoService {
  private readonly logger = new Logger(AdminIpoService.name);

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

    const anchorDoc = (ipo.documents ?? []).find((d) => d.documentType === 'ANCHOR_LIST');
    const anchorExt = (anchorDoc?.extractionData as any) || {};
    const anchorInvestors = Array.isArray(anchorExt.anchorInvestors) ? anchorExt.anchorInvestors : [];

    return {
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
  }

  /**
   * Searchable Admin list query returning all IPOs (DRAFT, PUBLISHED, ARCHIVED).
   */
  async listIpos(query: AdminIpoQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
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
        } else if (s === 'ALLOTMENT_PENDING' || s === 'ALLOTMENT_AWAITED') {
          where.status = IpoStatus.ALLOTMENT_PENDING;
        } else if (s === 'LISTED') {
          where.status = { in: [IpoStatus.LISTED, IpoStatus.LISTING_PENDING] };
        } else if (s === 'OPEN') {
          where.status = { in: [IpoStatus.OPEN, IpoStatus.CLOSING_TODAY, IpoStatus.DRAFT] };
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
      if (ipo.status === 'OPEN' || ipo.status === 'CLOSING_TODAY' || ipo.status === 'DRAFT') {
        statusCounts.OPEN = (statusCounts.OPEN || 0) + 1;
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

    try {
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
          const rawCat = cat.category || cat.categoryCode;
          if (!rawCat) continue;
          let categoryStr = String(rawCat).trim().toUpperCase();
          if (categoryStr.includes('RETAIL')) categoryStr = 'RETAIL';
          else if (categoryStr.includes('EMPLOYEE')) categoryStr = 'EMPLOYEE';
          else if (categoryStr.includes('SHAREHOLDER')) categoryStr = 'SHAREHOLDER';
          else if (categoryStr.includes('NII_SMALL') || categoryStr.includes('SNII')) categoryStr = 'NII_SMALL';
          else if (categoryStr.includes('NII_BIG') || categoryStr.includes('BNII')) categoryStr = 'NII_BIG';
          else if (categoryStr.includes('NII') || categoryStr.includes('NON_INSTITUTIONAL') || categoryStr.includes('NON INSTITUTIONAL')) categoryStr = 'NII';
          else if (categoryStr.includes('QIB') || categoryStr.includes('QUALIFIED')) categoryStr = 'QIB';

          if (!Object.values(OfferCategoryType).includes(categoryStr as OfferCategoryType)) {
            categoryStr = 'OTHER';
          }
          const category = categoryStr as OfferCategoryType;
          const allocationPct = cat.allocationPct !== undefined && cat.allocationPct !== null
            ? cat.allocationPct
            : (cat.allocationPercentage !== undefined && cat.allocationPercentage !== null
              ? cat.allocationPercentage
              : cat.allocationPercent);
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

      const rawLeadManager = payload.leadManager || companyData.leadManager;
      let leadManagerNames: string[] = [];
      if (Array.isArray(rawLeadManager)) {
        leadManagerNames = rawLeadManager.map((m) => String(m).trim()).filter(Boolean);
      } else if (typeof rawLeadManager === 'string' && rawLeadManager.trim()) {
        leadManagerNames = [rawLeadManager.trim()];
      }

      for (let i = 0; i < leadManagerNames.length; i++) {
        await tx.ipoParticipant.create({
          data: {
            ipoId: ipo.id,
            role: ParticipantRole.BRLM,
            name: leadManagerNames[i],
            displayOrder: 2 + i,
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
          const docTypeStr = (doc.documentType || doc.type || '').toString().toUpperCase();
          if (!docTypeStr) continue;
          let docType: DocumentType = DocumentType.OTHER;
          if (docTypeStr.includes('DRHP')) docType = DocumentType.DRHP;
          else if (docTypeStr.includes('RHP')) docType = DocumentType.RHP;
          else if (docTypeStr.includes('PROSPECTUS')) docType = DocumentType.PROSPECTUS;
          else if (docTypeStr.includes('ANCHOR')) docType = DocumentType.ANCHOR_LIST;
          else if (Object.values(DocumentType).includes(docTypeStr as DocumentType)) {
            docType = docTypeStr as DocumentType;
          }

          const sourceUrl = (doc.sourceUrl || doc.url || '').trim();
          if (!sourceUrl) continue;

          const existingDoc = await tx.ipoDocument.findFirst({
            where: { ipoId: ipo.id, documentType: docType, sourceUrl },
          });
          if (existingDoc) continue;

          await tx.ipoDocument.create({
            data: {
              ipoId: ipo.id,
              documentType: docType,
              fileName: doc.fileName?.trim() || doc.title?.trim() || null,
              sourceUrl,
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
  // ADD-ONLY JSON IMPORT: PREVIEW & COMMIT
  // =========================================================================

  private normalizeJsonPayloadItems(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.ipos)) return payload.ipos;
    if (Array.isArray(payload.data)) return payload.data;
    if (typeof payload === 'object') return [payload];
    return [];
  }

  private isFieldEmpty(val: any): boolean {
    if (val === null || val === undefined) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    return false;
  }

  private checkAddOnlyField(
    section: string,
    field: string,
    existingVal: any,
    inputVal: any,
    toFill: FieldDiffToFill[],
    skipped: FieldDiffSkipped[],
  ) {
    if (inputVal === undefined || inputVal === null) return;
    if (typeof inputVal === 'string' && inputVal.trim() === '') return;

    if (this.isFieldEmpty(existingVal)) {
      toFill.push({ section, field, newValue: inputVal });
    } else {
      let reason = 'Existing value preserved';
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
          existingVal instanceof Prisma.Decimal
            ? existingVal.toNumber()
            : existingVal,
        skippedValue: inputVal,
        reason,
      });
    }
  }

  private findMatchingIpoForAddOnly(
    item: any,
    allExistingIpos: any[],
  ): {
    status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
    matchedIpo?: any;
    reason: string;
  } {
    const targetIpoId = (
      item.id ||
      item.ipoId ||
      item.targetIpoId
    )?.trim?.();
    if (
      targetIpoId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        targetIpoId,
      )
    ) {
      const match = allExistingIpos.find((i) => i.id === targetIpoId);
      if (match) {
        return {
          status: 'MATCHED',
          matchedIpo: match,
          reason: `Matched by explicit ID (${targetIpoId})`,
        };
      }
    }

    const cin = (item.company?.cin || item.cin)?.trim?.();
    if (cin) {
      const matches = allExistingIpos.filter(
        (i) =>
          i.company?.cin &&
          i.company.cin.toLowerCase() === cin.toLowerCase(),
      );
      if (matches.length === 1) {
        return {
          status: 'MATCHED',
          matchedIpo: matches[0],
          reason: `Matched by CIN '${cin}'`,
        };
      }
      if (matches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          reason: `Ambiguous match: ${matches.length} IPOs share CIN '${cin}'`,
        };
      }
    }

    const symbol = (item.symbol || item.ipo?.symbol)?.trim?.().toUpperCase();
    if (symbol) {
      const matches = allExistingIpos.filter(
        (i) =>
          (i.symbol && i.symbol.toUpperCase() === symbol) ||
          (i.nseSymbol && i.nseSymbol.toUpperCase() === symbol) ||
          (i.bseSymbol && i.bseSymbol.toUpperCase() === symbol),
      );
      if (matches.length === 1) {
        return {
          status: 'MATCHED',
          matchedIpo: matches[0],
          reason: `Matched by Symbol '${symbol}'`,
        };
      }
      if (matches.length > 1) {
        return {
          status: 'AMBIGUOUS',
          reason: `Ambiguous match: ${matches.length} IPOs share Symbol '${symbol}'`,
        };
      }
    }

    const rawName = (
      item.companyName ||
      item.company?.legalName ||
      item.company?.displayName ||
      item.legalName ||
      item.ipoName
    )?.trim?.();
    if (rawName) {
      const normInput = normalizeName(rawName);
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
            reason: `Matched by Normalized Name '${rawName}'`,
          };
        }
        if (exactMatches.length > 1) {
          return {
            status: 'AMBIGUOUS',
            reason: `Ambiguous match: ${exactMatches.length} IPOs match Name '${rawName}'`,
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
  ): {
    fieldsToFill: FieldDiffToFill[];
    fieldsSkipped: FieldDiffSkipped[];
  } {
    const toFill: FieldDiffToFill[] = [];
    const skipped: FieldDiffSkipped[] = [];

    const companyData = item.company || {};
    const ipoData = item.ipo || {};
    const lifecycleData = item.lifecycle || {};
    const allotmentConfigData = item.allotmentConfig || {};
    const gmpData = item.gmp || {};

    const existingCompany = existingIpo.company || {};

    // 1. Company Level
    this.checkAddOnlyField(
      'company',
      'legalName',
      existingCompany.legalName,
      companyData.legalName || item.legalName || companyData.companyName,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'displayName',
      existingCompany.displayName,
      companyData.displayName || item.companyName || item.ipoName,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'cin',
      existingCompany.cin,
      companyData.cin || item.cin,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'contactPerson',
      existingCompany.contactPerson,
      companyData.contactPerson,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'logoUrl',
      existingCompany.logoUrl,
      companyData.logoUrl || item.logoUrl,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'website',
      existingCompany.website,
      companyData.website || item.website,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'phone',
      existingCompany.phone,
      companyData.phone || item.companyPhone,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'email',
      existingCompany.email,
      companyData.email || item.companyEmail,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'aboutDescription',
      existingCompany.aboutDescription,
      companyData.aboutDescription || item.notes,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'sector',
      existingCompany.sector,
      companyData.sector || item.sector,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'company',
      'industry',
      existingCompany.industry,
      companyData.industry || item.industry,
      toFill,
      skipped,
    );

    // 2. IPO Core Level
    this.checkAddOnlyField(
      'ipo',
      'symbol',
      existingIpo.symbol,
      ipoData.symbol || item.symbol,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'exchange',
      existingIpo.exchange,
      ipoData.exchange || item.exchange,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'marketSegment',
      existingIpo.marketSegment,
      ipoData.marketSegment || ipoData.issueType || item.issueType,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'priceBandLow',
      existingIpo.priceBandLow,
      ipoData.priceBandLow ?? ipoData.priceBandMin ?? item.priceBandMin,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'priceBandHigh',
      existingIpo.priceBandHigh,
      ipoData.priceBandHigh ?? ipoData.priceBandMax ?? item.priceBandMax,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'faceValue',
      existingIpo.faceValue,
      ipoData.faceValue ?? item.faceValue,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'lotSize',
      existingIpo.lotSize,
      ipoData.lotSize ?? item.lotSize,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'minimumLots',
      existingIpo.minimumLots,
      ipoData.minimumLots ?? item.minimumLots,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'issueSize',
      existingIpo.issueSize,
      ipoData.issueSize ?? item.issueSize,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'freshIssueSize',
      existingIpo.freshIssueSize,
      ipoData.freshIssueSize ?? item.freshIssueSize,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'ofsSize',
      existingIpo.ofsSize,
      ipoData.ofsSize ?? item.ofsSize,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'issueShareCount',
      existingIpo.issueShareCount,
      ipoData.issueShareCount ?? item.issueShareCount,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'freshIssueShareCount',
      existingIpo.freshIssueShareCount,
      ipoData.freshIssueShareCount ?? item.freshIssueShareCount,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'ipo',
      'ofsShareCount',
      existingIpo.ofsShareCount,
      ipoData.ofsShareCount ?? item.ofsShareCount,
      toFill,
      skipped,
    );

    // 3. Lifecycle Events
    const existingEvents = existingIpo.lifecycleEvents || [];
    const eventTypeMap: Record<string, string | undefined> = {
      OPEN: item.openDate || lifecycleData.openDate,
      CLOSE: item.closeDate || lifecycleData.closeDate,
      BASIS_OF_ALLOTMENT: item.allotmentDate || lifecycleData.allotmentDate,
      LISTING: item.listingDate || lifecycleData.listingDate,
      DRHP: lifecycleData.drhpDate,
      RHP: lifecycleData.rhpDate,
      ANCHOR: lifecycleData.anchorDate,
    };

    for (const [evType, inputDateStr] of Object.entries(eventTypeMap)) {
      if (inputDateStr) {
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
        );
      }
    }

    // 4. Allotment Config
    const existingAllotConfig = existingIpo.allotmentConfig || {};
    this.checkAddOnlyField(
      'allotmentConfig',
      'registrar',
      existingAllotConfig.registrar,
      allotmentConfigData.registrar || item.registrar,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'allotmentConfig',
      'registrarIpoCode',
      existingAllotConfig.registrarIpoCode,
      allotmentConfigData.registrarIpoCode || item.registrarIpoCode,
      toFill,
      skipped,
    );
    this.checkAddOnlyField(
      'allotmentConfig',
      'allotmentSourceUrl',
      existingAllotConfig.allotmentSourceUrl,
      allotmentConfigData.allotmentSourceUrl || item.allotmentSourceUrl,
      toFill,
      skipped,
    );

    // 5. Documents
    const existingDocs = existingIpo.documents || [];
    if (item.drhpUrl || item.drhp) {
      const doc = existingDocs.find((d: any) => d.documentType === 'DRHP');
      this.checkAddOnlyField(
        'documents',
        'DRHP',
        doc?.sourceUrl,
        item.drhpUrl || item.drhp,
        toFill,
        skipped,
      );
    }
    if (item.rhpUrl || item.rhp) {
      const doc = existingDocs.find((d: any) => d.documentType === 'RHP');
      this.checkAddOnlyField(
        'documents',
        'RHP',
        doc?.sourceUrl,
        item.rhpUrl || item.rhp,
        toFill,
        skipped,
      );
    }

    // 6. Offer Categories
    const existingCategories = existingIpo.offerCategories || [];
    const inputCategories =
      item.offerCategories || ipoData.offerCategories || [];
    if (Array.isArray(inputCategories)) {
      for (const catItem of inputCategories) {
        if (!catItem || typeof catItem !== 'object') continue;
        const catName = String(
          catItem.category || catItem.categoryCode || '',
        ).toUpperCase();
        if (!catName) continue;

        const existingCat = existingCategories.find(
          (c: any) => c.category === catName,
        );
        if (!existingCat) {
          toFill.push({
            section: 'offerCategories',
            field: `${catName} (NEW CATEGORY)`,
            newValue: catItem,
          });
        } else {
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.allocationPct`,
            existingCat.allocationPct,
            catItem.allocationPct,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.minLots`,
            existingCat.minLots,
            catItem.minLots,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.maxLots`,
            existingCat.maxLots,
            catItem.maxLots,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.minShares`,
            existingCat.minShares,
            catItem.minShares,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.maxShares`,
            existingCat.maxShares,
            catItem.maxShares,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.minAmount`,
            existingCat.minAmount,
            catItem.minAmount,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.maxAmount`,
            existingCat.maxAmount,
            catItem.maxAmount,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'offerCategories',
            `${catName}.isUpiEligible`,
            existingCat.isUpiEligible,
            catItem.isUpiEligible,
            toFill,
            skipped,
          );
        }
      }
    }

    // 7. Company Financials
    const existingFinancials = existingCompany.financials || [];
    const inputFinancials =
      companyData.financials || item.financials || [];
    if (Array.isArray(inputFinancials)) {
      for (const finItem of inputFinancials) {
        if (!finItem || typeof finItem !== 'object') continue;
        const period = String(finItem.fiscalPeriod || '').trim();
        const periodType = String(finItem.periodType || 'ANNUAL').toUpperCase();
        if (!period) continue;

        const existingFin = existingFinancials.find(
          (f: any) =>
            f.fiscalPeriod === period &&
            (f.periodType || 'ANNUAL') === periodType,
        );
        if (!existingFin) {
          toFill.push({
            section: 'financials',
            field: `${period} (${periodType}) (NEW PERIOD)`,
            newValue: finItem,
          });
        } else {
          this.checkAddOnlyField(
            'financials',
            `${period}.totalAssets`,
            existingFin.totalAssets,
            finItem.totalAssets,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.totalRevenue`,
            existingFin.totalRevenue,
            finItem.totalRevenue ?? finItem.revenue,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.pat`,
            existingFin.pat,
            finItem.pat ?? finItem.netProfit,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.ebitda`,
            existingFin.ebitda,
            finItem.ebitda,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.netWorth`,
            existingFin.netWorth,
            finItem.netWorth ?? finItem.nav,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.roePercentage`,
            existingFin.roePercentage,
            finItem.roePercentage ?? finItem.roePercent,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.rocePercentage`,
            existingFin.rocePercentage,
            finItem.rocePercentage,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.eps`,
            existingFin.eps,
            finItem.eps,
            toFill,
            skipped,
          );
          this.checkAddOnlyField(
            'financials',
            `${period}.patMarginPercent`,
            existingFin.patMarginPercent,
            finItem.patMarginPercent ?? finItem.patPercent,
            toFill,
            skipped,
          );
        }
      }
    }

    // 8. GMP Observation
    const existingGmp = existingIpo.gmpObservations || [];
    const gmpAmountVal = gmpData.gmpAmount ?? item.gmpAmount;
    if (gmpAmountVal !== undefined && gmpAmountVal !== null) {
      if (existingGmp.length === 0) {
        toFill.push({
          section: 'gmp',
          field: 'gmpAmount',
          newValue: gmpAmountVal,
        });
      } else {
        skipped.push({
          section: 'gmp',
          field: 'gmpAmount',
          existingValue: existingGmp[0]?.gmpAmount,
          skippedValue: gmpAmountVal,
          reason: 'Existing GMP observations preserved',
        });
      }
    }

    return { fieldsToFill: toFill, fieldsSkipped: skipped };
  }

  /**
   * Generates a safe, non-destructive preview of which fields will be filled or preserved.
   */
  async previewAddOnlyJsonImport(
    rawPayload: any,
  ): Promise<JsonImportPreviewResponse> {
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

    for (let idx = 0; idx < rawItems.length; idx++) {
      const item = rawItems[idx];
      const inputName =
        item.companyName ||
        item.company?.displayName ||
        item.company?.legalName ||
        item.legalName ||
        item.ipoName ||
        `Record #${idx + 1}`;
      const inputSymbol = item.symbol || item.ipo?.symbol;

      const matchResult = this.findMatchingIpoForAddOnly(item, allExistingIpos);

      if (matchResult.status === 'MATCHED' && matchResult.matchedIpo) {
        matchedCount++;
        const { fieldsToFill, fieldsSkipped } = this.diffIpoForAddOnly(
          matchResult.matchedIpo,
          item,
        );
        fieldsToFillTotal += fieldsToFill.length;

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
        });
      }
    }

    return {
      totalRecords: rawItems.length,
      matchedCount,
      unmatchedCount,
      ambiguousCount,
      fieldsToFillTotal,
      items: previewItems,
    };
  }

  /**
   * Performs an atomic ADD-ONLY update per matched IPO record.
   * Existing values are NEVER overwritten. 0 and false are strictly preserved.
   */
  async commitAddOnlyJsonImport(
    dto: JsonImportCommitDto | any,
  ): Promise<JsonImportCommitResponse> {
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
      const inputName =
        item.companyName ||
        item.company?.displayName ||
        item.company?.legalName ||
        item.legalName ||
        item.ipoName ||
        `Record #${idx + 1}`;

      const matchResult = this.findMatchingIpoForAddOnly(item, allExistingIpos);

      if (matchResult.status !== 'MATCHED' || !matchResult.matchedIpo) {
        skippedCount++;
        commitResults.push({
          index: idx,
          ipoName: inputName,
          success: false,
          status:
            matchResult.status === 'AMBIGUOUS'
              ? 'SKIPPED_AMBIGUOUS'
              : 'SKIPPED_UNMATCHED',
          fieldsFilledCount: 0,
          fieldsFilled: [],
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
          ipoName: targetIpo.company.displayName,
          success: false,
          status: 'SKIPPED_NO_CHANGES',
          fieldsFilledCount: 0,
          fieldsFilled: [],
          error: 'Not selected for import',
        });
        continue;
      }

      const { fieldsToFill } = this.diffIpoForAddOnly(targetIpo, item);
      if (fieldsToFill.length === 0) {
        skippedCount++;
        commitResults.push({
          index: idx,
          ipoId: targetIpo.id,
          ipoName: targetIpo.company.displayName,
          success: true,
          status: 'SKIPPED_NO_CHANGES',
          fieldsFilledCount: 0,
          fieldsFilled: [],
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
          );
        });

        updatedCount++;
        commitResults.push({
          index: idx,
          ipoId: targetIpo.id,
          ipoName: targetIpo.company.displayName,
          success: true,
          status: 'UPDATED',
          fieldsFilledCount: filled.length,
          fieldsFilled: filled,
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
          ipoName: targetIpo.company.displayName,
          success: false,
          status: 'FAILED',
          fieldsFilledCount: 0,
          fieldsFilled: [],
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
  ): Promise<string[]> {
    const currentIpo = await tx.ipo.findUniqueOrThrow({
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
        gmpObservations: true,
      },
    });

    const filledFields: string[] = [];
    const companyUpdates: Prisma.CompanyUpdateInput = {};
    const ipoUpdates: Prisma.IpoUpdateInput = {};

    const companyData = item.company || {};
    const ipoData = item.ipo || {};
    const lifecycleData = item.lifecycle || {};
    const allotmentConfigData = item.allotmentConfig || {};
    const gmpData = item.gmp || {};

    // 1. Company Updates
    const companyFields: Array<[string, any]> = [
      ['legalName', companyData.legalName || item.legalName],
      ['displayName', companyData.displayName || item.companyName || item.ipoName],
      ['cin', companyData.cin || item.cin],
      ['contactPerson', companyData.contactPerson],
      ['logoUrl', companyData.logoUrl || item.logoUrl],
      ['website', companyData.website || item.website],
      ['phone', companyData.phone || item.companyPhone],
      ['email', companyData.email || item.companyEmail],
      ['aboutDescription', companyData.aboutDescription || item.notes],
      ['sector', companyData.sector || item.sector],
      ['industry', companyData.industry || item.industry],
    ];

    for (const [key, val] of companyFields) {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        if (this.isFieldEmpty((currentIpo.company as any)[key])) {
          (companyUpdates as any)[key] = val;
          filledFields.push(`company.${key}`);
        }
      }
    }

    // 2. IPO Updates
    const ipoFields: Array<[string, any]> = [
      ['symbol', ipoData.symbol || item.symbol],
      ['exchange', ipoData.exchange || item.exchange],
      ['marketSegment', ipoData.marketSegment || ipoData.issueType || item.issueType],
      ['priceBandLow', ipoData.priceBandLow ?? ipoData.priceBandMin ?? item.priceBandMin],
      ['priceBandHigh', ipoData.priceBandHigh ?? ipoData.priceBandMax ?? item.priceBandMax],
      ['faceValue', ipoData.faceValue ?? item.faceValue],
      ['lotSize', ipoData.lotSize ?? item.lotSize],
      ['minimumLots', ipoData.minimumLots ?? item.minimumLots],
      ['issueSize', ipoData.issueSize ?? item.issueSize],
      ['freshIssueSize', ipoData.freshIssueSize ?? item.freshIssueSize],
      ['ofsSize', ipoData.ofsSize ?? item.ofsSize],
      ['issueShareCount', ipoData.issueShareCount ?? item.issueShareCount],
      ['freshIssueShareCount', ipoData.freshIssueShareCount ?? item.freshIssueShareCount],
      ['ofsShareCount', ipoData.ofsShareCount ?? item.ofsShareCount],
    ];

    for (const [key, val] of ipoFields) {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        if (this.isFieldEmpty((currentIpo as any)[key])) {
          (ipoUpdates as any)[key] = val;
          filledFields.push(`ipo.${key}`);
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
      OPEN: item.openDate || lifecycleData.openDate,
      CLOSE: item.closeDate || lifecycleData.closeDate,
      BASIS_OF_ALLOTMENT: item.allotmentDate || lifecycleData.allotmentDate,
      LISTING: item.listingDate || lifecycleData.listingDate,
      DRHP: lifecycleData.drhpDate,
      RHP: lifecycleData.rhpDate,
      ANCHOR: lifecycleData.anchorDate,
    };

    for (const [evType, dateStr] of Object.entries(eventTypeMap)) {
      if (dateStr && String(dateStr).trim() !== '') {
        const existingEv = currentIpo.lifecycleEvents.find(
          (e) => e.eventType === evType,
        );
        if (!existingEv || !existingEv.eventDate) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) {
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

    if (regName || regCode || regUrl) {
      const existingAllot = currentIpo.allotmentConfig;
      if (!existingAllot) {
        await tx.ipoAllotmentConfig.create({
          data: {
            ipoId: currentIpo.id,
            registrar: regName || 'UNKNOWN',
            registrarIpoCode: regCode || null,
            allotmentSourceUrl: regUrl || null,
          },
        });
        filledFields.push('allotmentConfig');
      } else {
        const allotUpdates: Prisma.IpoAllotmentConfigUpdateInput = {};
        if (regName && this.isFieldEmpty(existingAllot.registrar)) {
          allotUpdates.registrar = regName;
          filledFields.push('allotmentConfig.registrar');
        }
        if (regCode && this.isFieldEmpty(existingAllot.registrarIpoCode)) {
          allotUpdates.registrarIpoCode = regCode;
          filledFields.push('allotmentConfig.registrarIpoCode');
        }
        if (regUrl && this.isFieldEmpty(existingAllot.allotmentSourceUrl)) {
          allotUpdates.allotmentSourceUrl = regUrl;
          filledFields.push('allotmentConfig.allotmentSourceUrl');
        }
        if (Object.keys(allotUpdates).length > 0) {
          await tx.ipoAllotmentConfig.update({
            where: { ipoId: currentIpo.id },
            data: allotUpdates,
          });
        }
      }
    }

    // 5. Documents
    const drhpUrl = (item.drhpUrl || item.drhp)?.trim();
    if (drhpUrl) {
      const existingDrhp = currentIpo.documents.find(
        (d) => d.documentType === 'DRHP',
      );
      if (!existingDrhp || this.isFieldEmpty(existingDrhp.sourceUrl)) {
        await tx.ipoDocument.upsert({
          where: { id: existingDrhp?.id || '00000000-0000-0000-0000-000000000000' },
          create: {
            ipoId: currentIpo.id,
            documentType: 'DRHP' as any,
            sourceUrl: drhpUrl,
            parsingStatus: 'PENDING',
          },
          update: {
            sourceUrl: drhpUrl,
          },
        });
        filledFields.push('documents.DRHP');
      }
    }

    const rhpUrl = (item.rhpUrl || item.rhp)?.trim();
    if (rhpUrl) {
      const existingRhp = currentIpo.documents.find(
        (d) => d.documentType === 'RHP',
      );
      if (!existingRhp || this.isFieldEmpty(existingRhp.sourceUrl)) {
        await tx.ipoDocument.upsert({
          where: { id: existingRhp?.id || '00000000-0000-0000-0000-000000000000' },
          create: {
            ipoId: currentIpo.id,
            documentType: 'RHP' as any,
            sourceUrl: rhpUrl,
            parsingStatus: 'PENDING',
          },
          update: {
            sourceUrl: rhpUrl,
          },
        });
        filledFields.push('documents.RHP');
      }
    }

    // 6. Offer Categories
    const inputCategories =
      item.offerCategories || ipoData.offerCategories || [];
    if (Array.isArray(inputCategories)) {
      for (const catItem of inputCategories) {
        if (!catItem || typeof catItem !== 'object') continue;
        const catName = String(
          catItem.category || catItem.categoryCode || '',
        ).toUpperCase();
        if (!catName || !Object.values(OfferCategoryType).includes(catName as any))
          continue;

        const existingCat = currentIpo.offerCategories.find(
          (c) => c.category === catName,
        );

        if (!existingCat) {
          await tx.ipoOfferCategory.create({
            data: {
              ipoId: currentIpo.id,
              category: catName as any,
              allocationPct: catItem.allocationPct ?? null,
              minLots: catItem.minLots ?? null,
              maxLots: catItem.maxLots ?? null,
              minShares: catItem.minShares ?? null,
              maxShares: catItem.maxShares ?? null,
              minAmount: catItem.minAmount ?? null,
              maxAmount: catItem.maxAmount ?? null,
              isUpiEligible: catItem.isUpiEligible ?? true,
            },
          });
          filledFields.push(`offerCategories.${catName}`);
        } else {
          const catUpdates: Prisma.IpoOfferCategoryUpdateInput = {};
          const catFields: Array<[string, any]> = [
            ['allocationPct', catItem.allocationPct],
            ['minLots', catItem.minLots],
            ['maxLots', catItem.maxLots],
            ['minShares', catItem.minShares],
            ['maxShares', catItem.maxShares],
            ['minAmount', catItem.minAmount],
            ['maxAmount', catItem.maxAmount],
            ['isUpiEligible', catItem.isUpiEligible],
          ];
          for (const [k, v] of catFields) {
            if (v !== undefined && v !== null && this.isFieldEmpty((existingCat as any)[k])) {
              (catUpdates as any)[k] = v;
              filledFields.push(`offerCategories.${catName}.${k}`);
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

    // 7. Financials
    const inputFinancials =
      companyData.financials || item.financials || [];
    if (Array.isArray(inputFinancials)) {
      for (const finItem of inputFinancials) {
        if (!finItem || typeof finItem !== 'object') continue;
        const period = String(finItem.fiscalPeriod || '').trim();
        const periodType = String(finItem.periodType || 'ANNUAL').toUpperCase();
        if (!period) continue;

        const existingFin = currentIpo.company.financials.find(
          (f) =>
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
              totalRevenue: finItem.totalRevenue ?? finItem.revenue ?? null,
              pat: finItem.pat ?? finItem.netProfit ?? null,
              ebitda: finItem.ebitda ?? null,
              netWorth: finItem.netWorth ?? finItem.nav ?? null,
              roePercentage: finItem.roePercentage ?? finItem.roePercent ?? null,
              rocePercentage: finItem.rocePercentage ?? null,
              eps: finItem.eps ?? null,
              patMarginPercent: finItem.patMarginPercent ?? finItem.patPercent ?? null,
            },
          });
          filledFields.push(`financials.${period}`);
        } else {
          const finUpdates: Prisma.CompanyFinancialUpdateInput = {};
          const finFields: Array<[string, any]> = [
            ['totalAssets', finItem.totalAssets],
            ['totalRevenue', finItem.totalRevenue ?? finItem.revenue],
            ['pat', finItem.pat ?? finItem.netProfit],
            ['ebitda', finItem.ebitda],
            ['netWorth', finItem.netWorth ?? finItem.nav],
            ['roePercentage', finItem.roePercentage ?? finItem.roePercent],
            ['rocePercentage', finItem.rocePercentage],
            ['eps', finItem.eps],
            ['patMarginPercent', finItem.patMarginPercent ?? finItem.patPercent],
          ];
          for (const [k, v] of finFields) {
            if (v !== undefined && v !== null && this.isFieldEmpty((existingFin as any)[k])) {
              (finUpdates as any)[k] = v;
              filledFields.push(`financials.${period}.${k}`);
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

    // 8. GMP Observation
    const gmpAmountVal = gmpData.gmpAmount ?? item.gmpAmount;
    const gmpPercentVal = gmpData.gmpPercent ?? item.gmpPercent;
    if (
      gmpAmountVal !== undefined &&
      gmpAmountVal !== null &&
      currentIpo.gmpObservations.length === 0
    ) {
      await tx.gmpObservation.create({
        data: {
          ipoId: currentIpo.id,
          gmpAmount: gmpAmountVal,
          gmpPercentage: gmpPercentVal ?? null,
          observedAt: new Date(),
          sourceId: adminSourceId,
        },
      });
      filledFields.push('gmp.gmpAmount');
    }

    return filledFields;
  }
}

