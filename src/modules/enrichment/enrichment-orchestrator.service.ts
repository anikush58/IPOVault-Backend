import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IpoStatus,
  ParticipantRole,
  ProvenanceEntityType,
  PublicationStatus,
  SourceType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { persistRegistrarCode } from '../allotment/registrar.resolver';
import { SebiDocumentRetrievalService } from '../discovery/adapters/sebi/sebi-document-retrieval.service';
import { SebiSectionKey } from '../discovery/adapters/sebi/sebi-section.types';
import { AiStructuredExtractorService } from './ai/ai-structured-extractor.service';
import { EnrichmentValidatorService } from './enrichment-validator.service';
import { MissingFieldDetectorService } from './missing-field-detector.service';
import {
  AiExtractionRequest,
  EnrichableField,
  EnrichmentJobResult,
} from './enrichment.types';
import {
  extractRegistrarFromSections,
  isWithinActiveRegistrarWindow,
  sanitizeAndNormalizeRegistrar,
} from './registrar-extractor.util';
import { AiResearchOrchestratorService } from './research/ai-research-orchestrator.service';

export const AI_ENRICHMENT_SOURCE_CODE = 'SEBI_RHP_AI';

const FIELD_TO_SECTIONS_MAP: Record<EnrichableField, SebiSectionKey[]> = {
  aboutDescription: ['OUR_BUSINESS', 'SUMMARY_OF_THE_ISSUE'],
  sector: ['OUR_BUSINESS', 'INDUSTRY_OVERVIEW'],
  industry: ['OUR_BUSINESS', 'INDUSTRY_OVERVIEW'],
  financials: ['FINANCIAL_INFORMATION', 'SUMMARY_OF_THE_ISSUE'],
  strengthsAndRisks: ['RISK_FACTORS', 'OUR_BUSINESS', 'SUMMARY_OF_THE_ISSUE'],
  preIpoPe: ['BASIS_FOR_ISSUE_PRICE', 'SUMMARY_OF_THE_ISSUE'],
  postIpoPe: ['BASIS_FOR_ISSUE_PRICE', 'SUMMARY_OF_THE_ISSUE'],
  preIpoPromoterHolding: ['PROMOTERS_AND_SHAREHOLDING', 'CAPITAL_STRUCTURE'],
  postIpoPromoterHolding: ['PROMOTERS_AND_SHAREHOLDING', 'CAPITAL_STRUCTURE'],
  freshIssueShareCount: ['CAPITAL_STRUCTURE', 'FRESH_ISSUE_AND_OFS', 'SUMMARY_OF_THE_ISSUE'],
  ofsShareCount: ['CAPITAL_STRUCTURE', 'FRESH_ISSUE_AND_OFS', 'SUMMARY_OF_THE_ISSUE'],
  freshIssueSize: ['CAPITAL_STRUCTURE', 'FRESH_ISSUE_AND_OFS', 'SUMMARY_OF_THE_ISSUE'],
  ofsSize: ['CAPITAL_STRUCTURE', 'FRESH_ISSUE_AND_OFS', 'SUMMARY_OF_THE_ISSUE'],
  leadManagers: ['LEAD_MANAGERS_AND_GENERAL_INFO', 'SUMMARY_OF_THE_ISSUE'],
  registrar: ['LEAD_MANAGERS_AND_GENERAL_INFO', 'SUMMARY_OF_THE_ISSUE'],
  anchorDetails: ['ANCHOR_INVESTOR_PORTION'],
};

@Injectable()
export class EnrichmentOrchestratorService {
  private readonly logger = new Logger(EnrichmentOrchestratorService.name);
  private readonly activeIpoJobs = new Set<string>();
  private readonly enrichmentQueue: Array<{
    ipoId: string;
    options?: { forceRefresh?: boolean };
  }> = [];
  private readonly queuedIpoIds = new Set<string>();
  private activeWorkers = 0;
  private readonly MAX_CONCURRENCY = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly detector: MissingFieldDetectorService,
    private readonly sebiRetrievalService: SebiDocumentRetrievalService,
    private readonly aiExtractor: AiStructuredExtractorService,
    private readonly validator: EnrichmentValidatorService,
    @Optional()
    private readonly aiResearchOrchestrator?: AiResearchOrchestratorService,
  ) {}

  /**
   * Asynchronously enqueues missing-field enrichment for an IPO with deduplication
   * and strict concurrency cap (max 2 parallel workers).
   *
   * Never runs on the hot mobile read path.
   */
  async enqueueIpoEnrichment(
    ipoId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<void> {
    if (this.activeIpoJobs.has(ipoId) || this.queuedIpoIds.has(ipoId)) {
      this.logger.debug(
        `Enrichment job already in progress or queued for IPO '${ipoId}'. Skipping duplicate enqueue.`,
      );
      return;
    }

    this.queuedIpoIds.add(ipoId);
    this.enrichmentQueue.push({ ipoId, options });
    this.processNextInQueue();
  }

  private processNextInQueue(): void {
    if (this.activeWorkers >= this.MAX_CONCURRENCY || this.enrichmentQueue.length === 0) {
      return;
    }

    const next = this.enrichmentQueue.shift();
    if (!next) return;

    this.activeWorkers++;
    this.activeIpoJobs.add(next.ipoId);
    this.queuedIpoIds.delete(next.ipoId);

    setImmediate(async () => {
      try {
        await this.processIpoEnrichment(next.ipoId, next.options);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Background enrichment error for IPO '${next.ipoId}': ${msg}`);
      } finally {
        this.activeWorkers--;
        this.processNextInQueue();
      }
    });
  }

  public getQueueStats(): { active: number; queued: number; inFlight: number } {
    return {
      active: this.activeWorkers,
      queued: this.enrichmentQueue.length,
      inFlight: this.activeIpoJobs.size,
    };
  }

  /**
   * Processes end-to-end missing-field enrichment for an IPO.
   */
  async processIpoEnrichment(
    ipoId: string,
    options?: {
      forceRefresh?: boolean;
      customFetchImpl?: typeof fetch;
      skipResearchFallback?: boolean;
    },
  ): Promise<EnrichmentJobResult> {
    const startTime = Date.now();
    const startIso = new Date().toISOString();

    if (this.activeIpoJobs.has(ipoId)) {
      return {
        ipoId,
        status: 'SKIPPED',
        missingFieldsDetected: [],
        enrichedFields: [],
        skippedFields: [],
        startedAt: startIso,
        completedAt: new Date().toISOString(),
        durationMs: 0,
        error: 'Job already running for this IPO',
      };
    }

    this.activeIpoJobs.add(ipoId);

    try {
      this.logger.log(`Starting missing-field enrichment pipeline for IPO '${ipoId}'...`);

      // 1. Detect missing fields
      const report = await this.detector.detect(ipoId);
      if (!report || !report.hasMissingFields) {
        this.logger.log(`No missing fields detected for IPO '${ipoId}'. Enrichment complete.`);
        return {
          ipoId,
          status: 'SKIPPED',
          missingFieldsDetected: [],
          enrichedFields: [],
          skippedFields: [],
          startedAt: startIso,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      this.logger.log(
        `Detected ${report.missingFields.length} missing fields for '${report.companyName}': [${report.missingFields.join(', ')}]`,
      );

      // 2. Retrieve SEBI official document and extract sections via Phase 1 foundation
      const docResult = await this.sebiRetrievalService.retrieveAndExtractSections(ipoId, {
        forceRefresh: options?.forceRefresh,
        fetchImpl: options?.customFetchImpl,
      });

      if (docResult.status === 'DOCUMENT_UNRESOLVED') {
        if (
          report.missingFields.includes('registrar') &&
          !options?.skipResearchFallback
        ) {
          const fallbackRegistrar =
            await this.resolveRegistrarViaResearchFallback(ipoId, options);
          if (fallbackRegistrar) {
            return {
              ipoId,
              status: 'COMPLETED',
              missingFieldsDetected: report.missingFields,
              enrichedFields: ['registrar'],
              skippedFields: report.missingFields.filter(
                (f) => f !== 'registrar',
              ),
              startedAt: startIso,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
            };
          }
        }

        this.logger.log(
          `Official SEBI/Exchange/Issuer filing unresolved for IPO '${ipoId}'. Skipping AI extraction.`,
        );
        return {
          ipoId,
          status: 'DOCUMENT_UNRESOLVED',
          missingFieldsDetected: report.missingFields,
          enrichedFields: [],
          skippedFields: [],
          startedAt: startIso,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          error: docResult.error,
        };
      }

      if (docResult.status === 'DOWNLOAD_FAILED' || docResult.status === 'PARSE_FAILED') {
        this.logger.warn(
          `Document retrieval/parsing failed for IPO '${ipoId}': ${docResult.error}`,
        );
        return {
          ipoId,
          status: 'FAILED',
          missingFieldsDetected: report.missingFields,
          enrichedFields: [],
          skippedFields: [],
          documentHash: docResult.documentHash,
          startedAt: startIso,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          error: docResult.error,
        };
      }

      const availableSections = docResult.sections || {};

      // 3. Filter only relevant sections needed for the missing fields
      const relevantSectionKeys = new Set<SebiSectionKey>();
      for (const field of report.missingFields) {
        const requiredSections = FIELD_TO_SECTIONS_MAP[field] || [];
        for (const sec of requiredSections) {
          if (availableSections[sec]) {
            relevantSectionKeys.add(sec);
          }
        }
      }

      const targetedSections: Partial<Record<SebiSectionKey, string>> = {};
      for (const key of relevantSectionKeys) {
        if (availableSections[key]) {
          targetedSections[key] = availableSections[key]!.content;
        }
      }

      if (Object.keys(targetedSections).length === 0) {
        if (
          report.missingFields.includes('registrar') &&
          !options?.skipResearchFallback
        ) {
          const fallbackRegistrar =
            await this.resolveRegistrarViaResearchFallback(ipoId, options);
          if (fallbackRegistrar) {
            return {
              ipoId,
              status: 'COMPLETED',
              missingFieldsDetected: report.missingFields,
              enrichedFields: ['registrar'],
              skippedFields: report.missingFields.filter(
                (f) => f !== 'registrar',
              ),
              documentHash: docResult.documentHash,
              startedAt: startIso,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
            };
          }
        }

        this.logger.log(
          `No matching document sections available for missing fields on IPO '${ipoId}'.`,
        );
        return {
          ipoId,
          status: 'SKIPPED',
          missingFieldsDetected: report.missingFields,
          enrichedFields: [],
          skippedFields: report.missingFields,
          documentHash: docResult.documentHash,
          startedAt: startIso,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      }

      // 4. Deterministic registrar extraction + Structured AI extraction
      const deterministicRegistrar = report.missingFields.includes('registrar')
        ? extractRegistrarFromSections(availableSections)
        : null;
      const onlyMissingRegistrar = report.missingFields.every(
        (field) => field === 'registrar',
      );

      let extracted =
        deterministicRegistrar && onlyMissingRegistrar
          ? { registrar: deterministicRegistrar }
          : await this.aiExtractor.extract(
              {
                ipoId,
                companyName: report.companyName,
                missingFields: report.missingFields,
                documentSections: targetedSections,
              } satisfies AiExtractionRequest,
              options?.customFetchImpl,
            );

      if (!extracted && deterministicRegistrar) {
        extracted = { registrar: deterministicRegistrar };
      } else if (extracted && deterministicRegistrar) {
        extracted = {
          ...extracted,
          registrar: deterministicRegistrar,
        };
      }

      if (!extracted) {
        if (
          report.missingFields.includes('registrar') &&
          !options?.skipResearchFallback
        ) {
          const fallbackRegistrar =
            await this.resolveRegistrarViaResearchFallback(ipoId, options);
          if (fallbackRegistrar) {
            return {
              ipoId,
              status: 'COMPLETED',
              missingFieldsDetected: report.missingFields,
              enrichedFields: ['registrar'],
              skippedFields: report.missingFields.filter(
                (f) => f !== 'registrar',
              ),
              documentHash: docResult.documentHash,
              startedAt: startIso,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
            };
          }
        }

        this.logger.warn(`AI extraction produced no valid output for IPO '${ipoId}'`);
        return {
          ipoId,
          status: 'FAILED',
          missingFieldsDetected: report.missingFields,
          enrichedFields: [],
          skippedFields: report.missingFields,
          documentHash: docResult.documentHash,
          startedAt: startIso,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          error: 'AI extraction returned null or failed schema validation',
        };
      }

      // 5. Deterministic validation & calculations
      const existingIpo = await this.prisma.ipo.findUnique({
        where: { id: ipoId },
        include: {
          company: true,
          allotmentConfig: true,
          participants: true,
          sourceIdentities: { include: { source: true } },
          lifecycleEvents: true,
        },
      });

      if (!existingIpo) {
        throw new Error(`IPO '${ipoId}' disappeared during processing`);
      }

      const validated = this.validator.validate(extracted, {
        issueSize: existingIpo.issueSize,
        issueShareCount: existingIpo.issueShareCount,
      });

      // 6. Transactional persistence respecting source precedence
      const enrichedFields: string[] = [];
      const skippedFields: string[] = [];

      await this.persistValidatedEnrichment(
        ipoId,
        existingIpo,
        validated,
        docResult.sourceUrl || 'SEBI_RHP',
        docResult.documentHash || '',
        enrichedFields,
        skippedFields,
      );

      if (
        report.missingFields.includes('registrar') &&
        !enrichedFields.includes('registrar') &&
        !skippedFields.includes('registrar') &&
        !options?.skipResearchFallback
      ) {
        const fallbackRegistrar =
          await this.resolveRegistrarViaResearchFallback(ipoId, options);
        if (fallbackRegistrar) {
          enrichedFields.push('registrar');
        }
      }

      this.logger.log(
        `Enrichment completed for '${report.companyName}': ${enrichedFields.length} enriched, ${skippedFields.length} skipped`,
      );

      return {
        ipoId,
        status: 'COMPLETED',
        missingFieldsDetected: report.missingFields,
        enrichedFields,
        skippedFields,
        documentHash: docResult.documentHash,
        startedAt: startIso,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.activeIpoJobs.delete(ipoId);
    }
  }

  /**
   * Persists validated enrichment values safely without overwriting existing data.
   */
  private async persistValidatedEnrichment(
    ipoId: string,
    existingIpo: any,
    validated: ReturnType<EnrichmentValidatorService['validate']>,
    sourceUrl: string,
    documentHash: string,
    enrichedFields: string[],
    skippedFields: string[],
  ): Promise<void> {
    const sourceId = await this.ensureEnrichmentSource(sourceUrl);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // A. Update Company fields (aboutDescription, sector, industry)
      const companyUpdate: Record<string, any> = {};

      if (
        validated.aboutDescription &&
        (!existingIpo.company.aboutDescription || existingIpo.company.aboutDescription.trim() === '')
      ) {
        companyUpdate.aboutDescription = validated.aboutDescription;
        enrichedFields.push('aboutDescription');
      } else if (validated.aboutDescription) {
        skippedFields.push('aboutDescription');
      }

      if (
        validated.sector &&
        (!existingIpo.company.sector || existingIpo.company.sector.trim() === '')
      ) {
        companyUpdate.sector = validated.sector;
        enrichedFields.push('sector');
      } else if (validated.sector) {
        skippedFields.push('sector');
      }

      if (
        validated.industry &&
        (!existingIpo.company.industry || existingIpo.company.industry.trim() === '')
      ) {
        companyUpdate.industry = validated.industry;
        enrichedFields.push('industry');
      } else if (validated.industry) {
        skippedFields.push('industry');
      }

      if (Object.keys(companyUpdate).length > 0) {
        await tx.company.update({
          where: { id: existingIpo.company.id },
          data: companyUpdate,
        });

        // Record Field Provenance for Company fields
        for (const [fieldName, val] of Object.entries(companyUpdate)) {
          await tx.fieldProvenance.create({
            data: {
              entityType: ProvenanceEntityType.COMPANY,
              entityId: existingIpo.company.id,
              fieldName,
              value: String(val),
              sourceId,
              sourceReference: `${sourceUrl} | Hash: ${documentHash}`,
              retrievedAt: now,
              confidence: 0.95,
            },
          });
        }
      }

      // B. Update Company Multi-Period Financials
      if (Array.isArray(validated.financials) && validated.financials.length > 0) {
        for (const fin of validated.financials) {
          const periodType = fin.periodType || 'ANNUAL';
          const existingFin = await tx.companyFinancial.findUnique({
            where: {
              companyId_fiscalPeriod_periodType: {
                companyId: existingIpo.company.id,
                fiscalPeriod: fin.fiscalPeriod,
                periodType,
              },
            },
          });

          if (!existingFin) {
            await tx.companyFinancial.create({
              data: {
                companyId: existingIpo.company.id,
                fiscalPeriod: fin.fiscalPeriod,
                periodType,
                totalRevenue: fin.totalRevenue != null ? fin.totalRevenue : undefined,
                pat: fin.pat != null ? fin.pat : undefined,
                ebitda: fin.ebitda != null ? fin.ebitda : undefined,
                netWorth: fin.netWorth != null ? fin.netWorth : undefined,
                totalAssets: fin.totalAssets != null ? fin.totalAssets : undefined,
                eps: fin.eps != null ? fin.eps : undefined,
                roePercentage: fin.roePercentage != null ? fin.roePercentage : undefined,
                rocePercentage: fin.rocePercentage != null ? fin.rocePercentage : undefined,
              },
            });
            enrichedFields.push(`financials_${fin.fiscalPeriod}`);
          }
        }
      }

      // C. Update IPO fields (P/E, Promoter Holding, Fresh/OFS Share counts)
      const ipoUpdate: Record<string, any> = {};

      if (validated.preIpoPe != null && existingIpo.preIpoPe === null) {
        ipoUpdate.preIpoPe = validated.preIpoPe;
        enrichedFields.push('preIpoPe');
      }
      if (validated.postIpoPe != null && existingIpo.postIpoPe === null) {
        ipoUpdate.postIpoPe = validated.postIpoPe;
        enrichedFields.push('postIpoPe');
      }

      if (validated.preIpoPromoterHolding != null && existingIpo.preIpoPromoterHolding === null) {
        ipoUpdate.preIpoPromoterHolding = validated.preIpoPromoterHolding;
        enrichedFields.push('preIpoPromoterHolding');
      }
      if (validated.postIpoPromoterHolding != null && existingIpo.postIpoPromoterHolding === null) {
        ipoUpdate.postIpoPromoterHolding = validated.postIpoPromoterHolding;
        enrichedFields.push('postIpoPromoterHolding');
      }

      if (validated.freshIssueShareCount != null && existingIpo.freshIssueShareCount === null) {
        ipoUpdate.freshIssueShareCount = validated.freshIssueShareCount;
        enrichedFields.push('freshIssueShareCount');
      }
      if (validated.ofsShareCount != null && existingIpo.ofsShareCount === null) {
        ipoUpdate.ofsShareCount = validated.ofsShareCount;
        enrichedFields.push('ofsShareCount');
      }

      if (validated.freshIssueSize != null && existingIpo.freshIssueSize === null) {
        ipoUpdate.freshIssueSize = validated.freshIssueSize;
        enrichedFields.push('freshIssueSize');
      }
      if (validated.ofsSize != null && existingIpo.ofsSize === null) {
        ipoUpdate.ofsSize = validated.ofsSize;
        enrichedFields.push('ofsSize');
      }

      if (Object.keys(ipoUpdate).length > 0) {
        await tx.ipo.update({
          where: { id: ipoId },
          data: ipoUpdate,
        });

        // Record Field Provenance for IPO fields
        for (const [fieldName, val] of Object.entries(ipoUpdate)) {
          await tx.fieldProvenance.create({
            data: {
              entityType: ProvenanceEntityType.IPO,
              entityId: ipoId,
              fieldName,
              value: String(val),
              sourceId,
              sourceReference: `${sourceUrl} | Hash: ${documentHash}`,
              retrievedAt: now,
              confidence: 0.95,
            },
          });
        }
      }

      // D. Lead Managers (BRLMs)
      if (Array.isArray(validated.leadManagers) && validated.leadManagers.length > 0) {
        const existingParticipants = await tx.ipoParticipant.findMany({
          where: {
            ipoId,
            role: { in: [ParticipantRole.BRLM, ParticipantRole.CO_BRLM] },
          },
        });

        if (existingParticipants.length === 0) {
          for (let i = 0; i < validated.leadManagers.length; i++) {
            const name = validated.leadManagers[i];
            await tx.ipoParticipant.create({
              data: {
                ipoId,
                role: ParticipantRole.BRLM,
                name,
                displayOrder: i + 1,
              },
            });
          }
          enrichedFields.push('leadManagers');
        }
      }

      // D2. Registrar (Canonical persist via persistRegistrarCode)
      if (validated.registrar) {
        if (existingIpo.allotmentConfig?.enabled === false) {
          skippedFields.push('registrar');
        } else if (this.hasValidRegistrar(existingIpo)) {
          skippedFields.push('registrar');
        } else {
          const persisted = await persistRegistrarCode({
            prisma: tx,
            ipoId,
            registrarCode: validated.registrar,
            allowRegistrarWithoutCode: true,
            preserveExistingCode: true,
            ensureParticipant: true,
            context: 'SEBI RHP enrichment',
            logger: this.logger,
          });

          if (persisted) {
            enrichedFields.push('registrar');
            await tx.fieldProvenance.create({
              data: {
                entityType: ProvenanceEntityType.IPO,
                entityId: ipoId,
                fieldName: 'registrar_name',
                value: validated.registrar,
                sourceId,
                sourceReference: sourceUrl,
                retrievedAt: now,
              },
            });
          } else {
            skippedFields.push('registrar');
          }
        }
      }

      // E. Update Document Extraction metadata with Strengths, Risks & Anchor details
      if (
        (validated.strengths && validated.strengths.length > 0) ||
        (validated.risks && validated.risks.length > 0) ||
        validated.anchorDetails
      ) {
        const doc = await tx.ipoDocument.findFirst({
          where: { ipoId, documentType: { in: ['RHP', 'DRHP', 'PROSPECTUS'] } },
        });

        if (doc) {
          const currentExt = (doc.extractionData as Record<string, any>) || {};
          await tx.ipoDocument.update({
            where: { id: doc.id },
            data: {
              extractionData: {
                ...currentExt,
                strengths: validated.strengths || currentExt.strengths,
                risks: validated.risks || currentExt.risks,
                anchorDetails: validated.anchorDetails || currentExt.anchorDetails,
              },
            },
          });
          if (validated.strengths) enrichedFields.push('strengths');
          if (validated.risks) enrichedFields.push('risks');
          if (validated.anchorDetails) enrichedFields.push('anchorDetails');
        }
      }
    });
  }

  /**
   * Safely backfills missing fields for existing incomplete IPOs (SME or Mainboard).
   * Runs in the background with concurrency control and deduplication.
   */
  async backfillIncompleteIpos(options?: {
    marketSegment?: 'SME' | 'MAINBOARD';
    limit?: number;
    forceRefresh?: boolean;
  }): Promise<{ queuedCount: number; ipoIds: string[] }> {
    const where: any = {};
    if (options?.marketSegment) {
      where.marketSegment = options.marketSegment;
    }

    const ipos = await this.prisma.ipo.findMany({
      where,
      select: { id: true },
      take: options?.limit ?? 50,
      orderBy: { createdAt: 'desc' },
    });

    const queuedIpoIds: string[] = [];
    for (const ipo of ipos) {
      const report = await this.detector.detect(ipo.id);
      if (report && report.hasMissingFields) {
        queuedIpoIds.push(ipo.id);
        await this.enqueueIpoEnrichment(ipo.id, { forceRefresh: options?.forceRefresh });
      }
    }

    this.logger.log(
      `Backfill scan completed: queued ${queuedIpoIds.length} incomplete IPOs for enrichment.`,
    );

    return {
      queuedCount: queuedIpoIds.length,
      ipoIds: queuedIpoIds,
    };
  }

  /**
   * Bounded registrar backfill scoped strictly to active or recently listed (<= 30 days)
   * PUBLISHED IPOs missing a valid registrar across config, participants, and source identities.
   */
  async backfillMissingRegistrarsForActiveIpos(options?: {
    dryRun?: boolean;
    limit?: number;
    now?: Date;
    forceRefresh?: boolean;
  }): Promise<{
    dryRun: boolean;
    candidateCount: number;
    queuedCount: number;
    ipoIds: string[];
  }> {
    const dryRun = options?.dryRun ?? false;
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
    const now = options?.now ?? new Date();

    const ipos = await this.prisma.ipo.findMany({
      where: {
        publicationStatus: PublicationStatus.PUBLISHED,
        status: {
          in: [
            IpoStatus.UPCOMING,
            IpoStatus.OPEN,
            IpoStatus.CLOSING_TODAY,
            IpoStatus.CLOSED,
            IpoStatus.ALLOTMENT_PENDING,
            IpoStatus.LISTED,
          ],
        },
      },
      include: {
        allotmentConfig: true,
        participants: true,
        sourceIdentities: { include: { source: true } },
        lifecycleEvents: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 4,
    });

    const candidateIds: string[] = [];
    for (const ipo of ipos) {
      if (!isWithinActiveRegistrarWindow(ipo, now)) continue;
      if (ipo.allotmentConfig?.enabled === false) continue;
      if (this.hasValidRegistrar(ipo)) continue;
      candidateIds.push(ipo.id);
      if (candidateIds.length >= limit) break;
    }

    if (!dryRun) {
      for (const id of candidateIds) {
        await this.enqueueIpoEnrichment(id, {
          forceRefresh: options?.forceRefresh,
        });
      }
    }

    return {
      dryRun,
      candidateCount: candidateIds.length,
      queuedCount: dryRun ? 0 : candidateIds.length,
      ipoIds: candidateIds,
    };
  }

  private hasValidRegistrar(ipo: {
    allotmentConfig?: { registrar?: string | null } | null;
    participants?: Array<{ role?: string | null; name?: string | null }> | null;
    sourceIdentities?: Array<{
      source?: {
        sourceType?: string | null;
        code?: string | null;
        name?: string | null;
      } | null;
    }> | null;
  }): boolean {
    if (sanitizeAndNormalizeRegistrar(ipo.allotmentConfig?.registrar)) {
      return true;
    }
    if (
      (ipo.participants ?? []).some(
        (p) =>
          p.role === ParticipantRole.REGISTRAR &&
          Boolean(sanitizeAndNormalizeRegistrar(p.name)),
      )
    ) {
      return true;
    }
    return (ipo.sourceIdentities ?? []).some(
      (si) =>
        si.source?.sourceType === 'REGISTRAR' &&
        Boolean(
          sanitizeAndNormalizeRegistrar(si.source?.code || si.source?.name),
        ),
    );
  }

  private async resolveRegistrarViaResearchFallback(
    ipoId: string,
    options?: {
      forceRefresh?: boolean;
      customFetchImpl?: typeof fetch;
    },
  ): Promise<string | null> {
    if (!this.aiResearchOrchestrator) {
      return null;
    }

    const ipo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
      include: {
        allotmentConfig: true,
        participants: true,
        sourceIdentities: { include: { source: true } },
        lifecycleEvents: true,
      },
    });

    if (!ipo || !isWithinActiveRegistrarWindow(ipo)) {
      return null;
    }

    if (ipo.allotmentConfig?.enabled === false || this.hasValidRegistrar(ipo)) {
      return null;
    }

    try {
      await this.aiResearchOrchestrator.executeResearchNow(ipoId, {
        forceRefresh: options?.forceRefresh,
        customFetchImpl: options?.customFetchImpl,
      });

      const refreshedConfig =
        typeof this.prisma?.ipoAllotmentConfig?.findUnique === 'function'
          ? await this.prisma.ipoAllotmentConfig.findUnique({
              where: { ipoId },
            })
          : null;

      const normalized = sanitizeAndNormalizeRegistrar(
        refreshedConfig?.registrar,
      );
      if (!normalized) {
        return null;
      }

      if (refreshedConfig?.registrar !== normalized) {
        await persistRegistrarCode({
          prisma: this.prisma,
          ipoId,
          registrarCode: normalized,
          allowRegistrarWithoutCode: true,
          preserveExistingCode: true,
          ensureParticipant: true,
          context: 'AI web research registrar fallback normalization',
          logger: this.logger,
        });
      }

      return normalized;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Bounded registrar research fallback failed for IPO '${ipoId}': ${msg}`,
      );
      return null;
    }
  }

  /**
   * Ensures the appropriate AI enrichment source exists in PostgreSQL (SEBI, BSE, NSE, or Issuer).
   */
  private async ensureEnrichmentSource(sourceUrl = ''): Promise<string> {
    const lower = sourceUrl.toLowerCase();
    let code = AI_ENRICHMENT_SOURCE_CODE;
    let name = 'SEBI RHP AI Extraction';
    let baseUrl = 'https://www.sebi.gov.in';

    if (lower.includes('bseindia') || lower.includes('bsesme') || lower.includes('bse.test')) {
      code = 'BSE_SME_AI';
      name = 'BSE SME Prospectus AI Extraction';
      baseUrl = 'https://www.bseindia.com';
    } else if (lower.includes('nseindia') || lower.includes('nse.test')) {
      code = 'NSE_EMERGE_AI';
      name = 'NSE Emerge Prospectus AI Extraction';
      baseUrl = 'https://www.nseindia.com';
    } else if (lower.includes('sebi.gov.in') || lower.includes('sebi.test')) {
      code = AI_ENRICHMENT_SOURCE_CODE;
      name = 'SEBI RHP AI Extraction';
      baseUrl = 'https://www.sebi.gov.in';
    } else {
      code = 'ISSUER_PROSPECTUS_AI';
      name = 'Issuer Prospectus AI Extraction';
      try {
        const u = new URL(sourceUrl);
        baseUrl = `${u.protocol}//${u.host}`;
      } catch {
        baseUrl = 'https://issuer.official';
      }
    }

    const source = await this.prisma.source.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        sourceType: SourceType.OFFICIAL_FILING,
        baseUrl,
        priority: 75,
        enabled: true,
      },
    });
    return source.id;
  }
}
