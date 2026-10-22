import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IpoChangeType, LifecycleEventType, Prisma, ProvenanceEntityType, SourceType } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../../database/prisma.service';
import { AiResearchAgentService } from './ai-research-agent.service';
import { AiResearchReconciliationService } from './ai-research-reconciliation.service';
import {
  FieldReconciliationDecision,
  IpoReconciliationSummary,
  ResearchJob,
  SourceAuthorityTier,
} from './research.types';

export const AI_RESEARCH_SOURCE_CODE = 'AI_RESEARCH_ENGINE';

@Injectable()
export class AiResearchOrchestratorService {
  private readonly logger = new Logger(AiResearchOrchestratorService.name);

  // In-memory concurrency and job registry
  private readonly activeIpoRuns = new Set<string>();
  private readonly jobs = new Map<string, ResearchJob>();
  private readonly ipoToLatestJob = new Map<string, string>();

  // Bounded concurrency queue
  private readonly MAX_CONCURRENCY = 2;
  private runningWorkers = 0;
  private readonly queue: Array<() => Promise<void>> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: AiResearchAgentService,
    private readonly reconciler: AiResearchReconciliationService,
  ) {}

  /**
   * Enqueues or starts a background research job for an IPO.
   * Returns immediately with job metadata so the client can poll or navigate away.
   */
  async startResearchJob(
    ipoId: string,
    options?: {
      forceRefresh?: boolean;
      customFetchImpl?: typeof fetch;
      retryDelayMs?: number;
    },
  ): Promise<ResearchJob> {
    const existingIpo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
      include: { company: true },
    });
    if (!existingIpo) {
      throw new NotFoundException(`IPO with ID '${ipoId}' not found.`);
    }

    const companyName = existingIpo.company.displayName || existingIpo.company.legalName;

    // Check if an active job already exists for this IPO
    const existingJobId = this.ipoToLatestJob.get(ipoId);
    if (existingJobId) {
      const activeJob = this.jobs.get(existingJobId);
      if (activeJob && (activeJob.status === 'RUNNING' || activeJob.status === 'QUEUED')) {
        this.logger.log(`Returning existing active research job '${existingJobId}' for IPO '${ipoId}'`);
        return activeJob;
      }
    }

    const jobId = `res-job-${randomUUID()}`;
    const job: ResearchJob = {
      jobId,
      ipoId,
      companyName,
      status: 'QUEUED',
      progressPercent: 5,
      progressMessage: 'Queued in background worker pool...',
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);
    this.ipoToLatestJob.set(ipoId, jobId);

    // Enqueue bounded execution
    this.enqueueTask(async () => {
      await this.runJobInternal(job, options);
    });

    return job;
  }

  /**
   * Retrieves the current status and results of a research job by ID.
   */
  getJob(jobId: string): ResearchJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Executes research synchronously and returns the complete reconciliation report.
   * Useful for unit tests, CLI scripts, and synchronous API responses.
   */
  async executeResearchNow(
    ipoId: string,
    options?: {
      forceRefresh?: boolean;
      customFetchImpl?: typeof fetch;
      retryDelayMs?: number;
    },
  ): Promise<IpoReconciliationSummary> {
    const job = await this.startResearchJob(ipoId, options);

    // Wait until job finishes
    while (job.status === 'QUEUED' || job.status === 'RUNNING') {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (job.status === 'FAILED') {
      throw new Error(job.error || 'AI Research job failed');
    }

    return job.summary!;
  }

  /**
   * Batch schedules research for multiple IPOs with bounded concurrency.
   */
  async batchResearchIpos(
    ipoIds: string[],
    options?: { forceRefresh?: boolean; customFetchImpl?: typeof fetch },
  ): Promise<ResearchJob[]> {
    const jobs: ResearchJob[] = [];
    for (const id of ipoIds) {
      try {
        const job = await this.startResearchJob(id, options);
        jobs.push(job);
      } catch (err: any) {
        this.logger.error(`Failed to enqueue research for IPO '${id}': ${err.message}`);
      }
    }
    return jobs;
  }

  /**
   * Worker task queue with bounded concurrency.
   */
  private enqueueTask(task: () => Promise<void>) {
    this.queue.push(task);
    this.pumpQueue();
  }

  private pumpQueue() {
    while (this.runningWorkers < this.MAX_CONCURRENCY && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      this.runningWorkers++;
      task().finally(() => {
        this.runningWorkers--;
        this.pumpQueue();
      });
    }
  }

  /**
   * Internal job execution logic with safe boundaries and error handling.
   */
  private async runJobInternal(
    job: ResearchJob,
    options?: {
      forceRefresh?: boolean;
      customFetchImpl?: typeof fetch;
      retryDelayMs?: number;
    },
  ): Promise<void> {
    const startTime = Date.now();
    const { ipoId } = job;

    if (this.activeIpoRuns.has(ipoId)) {
      job.status = 'FAILED';
      job.error = 'Concurrent run already in progress for this IPO';
      job.completedAt = new Date().toISOString();
      job.durationMs = Date.now() - startTime;
      return;
    }

    this.activeIpoRuns.add(ipoId);
    job.status = 'RUNNING';
    job.progressPercent = 15;
    job.progressMessage = 'Loading current IPO data & field provenances...';

    try {
      // 1. Fetch current IPO details with all relations
      const ipo = await this.prisma.ipo.findUnique({
        where: { id: ipoId },
        include: {
          company: true,
          lifecycleEvents: true,
          allotmentConfig: true,
          participants: true,
          documents: true,
        },
      });

      if (!ipo) {
        throw new Error(`IPO with ID '${ipoId}' not found.`);
      }

      const existingProvenances = await this.prisma.fieldProvenance.findMany({
        where: {
          OR: [
            { entityType: 'IPO', entityId: ipo.id },
            { entityType: 'COMPANY', entityId: ipo.companyId },
          ],
        },
        include: { source: true },
      });

      // 2. Dispatch Live Web Search Research
      job.progressPercent = 35;
      job.progressMessage = 'Researching SEBI, NSE, BSE, & official registrar filings...';

      const candidates = await this.agent.researchIpo(ipo, {
        customFetchImpl: options?.customFetchImpl,
        retryDelayMs: options?.retryDelayMs,
      });

      // 3. Field-by-field Reconciliation
      job.progressPercent = 65;
      job.progressMessage = 'Reconciling candidate fields & checking source authority...';

      const summary = this.reconciler.reconcile(ipo, candidates, existingProvenances);

      // Check for upstream agent failure
      const isUpstreamFailure = candidates?.diagnostics?.status === 'FAILED';
      job.diagnostics = candidates?.diagnostics;

      // 4. Safe Transactional Persistence
      job.progressPercent = 85;
      job.progressMessage = 'Applying verified updates in safe database transaction...';

      const appliedDecisions = summary.decisions.filter((d) => d.autoApply);
      if (appliedDecisions.length > 0) {
        await this.persistReconciliation(ipo, appliedDecisions);
        for (const d of appliedDecisions) {
          d.applied = true;
        }
      }

      summary.appliedCount = appliedDecisions.length;
      job.summary = summary;

      if (isUpstreamFailure) {
        job.status = 'FAILED';
        job.error = candidates?.diagnostics?.errorMessage || 'Upstream AI research failed';
        job.progressPercent = 100;
        job.progressMessage = `Research failed upstream: ${job.error}`;
      } else {
        job.status = summary.conflictsCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
        job.progressPercent = 100;
        job.progressMessage =
          appliedDecisions.length > 0
            ? `Research complete. Applied ${appliedDecisions.length} verified updates (${summary.conflictsCount} conflicts flagged).`
            : `Research complete. 0 verified updates (${summary.conflictsCount} conflicts, ${summary.unverifiableCount} unverifiable, ${summary.missingCount} missing).`;
      }

      job.completedAt = new Date().toISOString();
      job.durationMs = Date.now() - startTime;

      this.logger.log(
        `AI Research job '${job.jobId}' finished for '${job.companyName}': status=${job.status}, applied=${appliedDecisions.length}, conflicts=${summary.conflictsCount}, duration=${job.durationMs}ms`,
      );
    } catch (err: any) {
      this.logger.error(`AI Research job '${job.jobId}' failed: ${err.message}`, err.stack);
      job.status = 'FAILED';
      job.error = err.message || String(err);
      job.completedAt = new Date().toISOString();
      job.durationMs = Date.now() - startTime;
    } finally {
      this.activeIpoRuns.delete(ipoId);
    }
  }

  /**
   * Persists verified reconciliation decisions in a single safe database transaction.
   */
  public async persistReconciliation(
    ipo: any,
    decisionsToApply: FieldReconciliationDecision[],
  ): Promise<void> {
    if (decisionsToApply.length === 0) return;

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const companyUpdates: Record<string, any> = {};
      const ipoUpdates: Record<string, any> = {};

      for (const d of decisionsToApply) {
        // Resolve or create source record
        const sourceId = await this.ensureResearchSource(tx, d.sourceAuthority, d.sourceUrl);

        // A. Company Fields
        if (d.entityType === 'COMPANY') {
          const compKey = d.fieldKey.replace('company.', '');
          companyUpdates[compKey] = d.candidateValue;

          await tx.fieldProvenance.create({
            data: {
              entityType: ProvenanceEntityType.COMPANY,
              entityId: ipo.companyId,
              fieldName: d.fieldKey,
              value: String(d.candidateValue),
              sourceId,
              sourceReference: `${d.sourceUrl || 'AI Research'} | Evidence: ${d.evidence || 'N/A'}`,
              retrievedAt: now,
              confidence: new Prisma.Decimal(d.confidence || 0.95),
            },
          });
        }

        // B. IPO Fields
        if (d.entityType === 'IPO') {
          ipoUpdates[d.fieldKey] = d.candidateValue;

          await tx.fieldProvenance.create({
            data: {
              entityType: ProvenanceEntityType.IPO,
              entityId: ipo.id,
              fieldName: d.fieldKey,
              value: String(d.candidateValue),
              sourceId,
              sourceReference: `${d.sourceUrl || 'AI Research'} | Evidence: ${d.evidence || 'N/A'}`,
              retrievedAt: now,
              confidence: new Prisma.Decimal(d.confidence || 0.95),
            },
          });

          // Log IPO Change Event
          await tx.ipoChangeEvent.create({
            data: {
              ipoId: ipo.id,
              fieldName: d.fieldKey,
              oldValue: d.currentValueDisplay,
              newValue: d.candidateValueDisplay,
              sourceId,
              sourceReference: d.sourceUrl || 'AI Research',
              detectedAt: now,
              changeType: this.mapFieldToChangeType(d.fieldKey),
            },
          });
        }

        // C. Lifecycle Event Fields
        if (d.entityType === 'LIFECYCLE') {
          const eventType = this.mapFieldToLifecycleEventType(d.fieldKey);
          if (eventType && d.candidateValue) {
            const eventDate = new Date(`${d.candidateValue}T00:00:00Z`);
            await tx.ipoLifecycleEvent.upsert({
              where: {
                ipoId_eventType: {
                  ipoId: ipo.id,
                  eventType,
                },
              },
              update: {
                eventDate,
                sourceId,
                sourceReference: d.sourceUrl || 'AI Research',
              },
              create: {
                ipoId: ipo.id,
                eventType,
                eventDate,
                sourceId,
                sourceReference: d.sourceUrl || 'AI Research',
              },
            });

            await tx.fieldProvenance.create({
              data: {
                entityType: ProvenanceEntityType.IPO,
                entityId: ipo.id,
                fieldName: d.fieldKey,
                value: String(d.candidateValue),
                sourceId,
                sourceReference: `${d.sourceUrl || 'AI Research'} | Evidence: ${d.evidence || 'N/A'}`,
                retrievedAt: now,
                confidence: new Prisma.Decimal(d.confidence || 0.95),
              },
            });
          }
        }

        // D. Allotment Config Fields
        if (d.entityType === 'ALLOTMENT_CONFIG') {
          if (d.fieldKey === 'registrarName' && d.candidateValue) {
            await tx.ipoAllotmentConfig.upsert({
              where: { ipoId: ipo.id },
              update: {
                registrar: String(d.candidateValue),
              },
              create: {
                ipoId: ipo.id,
                registrar: String(d.candidateValue),
              },
            });
          } else if (d.fieldKey === 'registrarIpoCode' && d.candidateValue) {
            await tx.ipoAllotmentConfig.upsert({
              where: { ipoId: ipo.id },
              update: {
                registrarIpoCode: String(d.candidateValue),
              },
              create: {
                ipoId: ipo.id,
                registrar: 'UNKNOWN',
                registrarIpoCode: String(d.candidateValue),
              },
            });
          }

          await tx.fieldProvenance.create({
            data: {
              entityType: ProvenanceEntityType.IPO,
              entityId: ipo.id,
              fieldName: d.fieldKey,
              value: String(d.candidateValue),
              sourceId,
              sourceReference: `${d.sourceUrl || 'AI Research'} | Evidence: ${d.evidence || 'N/A'}`,
              retrievedAt: now,
              confidence: new Prisma.Decimal(d.confidence || 0.95),
            },
          });
        }
      }

      // Execute bulk updates on Company and IPO
      if (Object.keys(companyUpdates).length > 0) {
        await tx.company.update({
          where: { id: ipo.companyId },
          data: companyUpdates,
        });
      }

      if (Object.keys(ipoUpdates).length > 0) {
        await tx.ipo.update({
          where: { id: ipo.id },
          data: ipoUpdates,
        });
      }
    });
  }

  /**
   * Resolves or dynamically creates a typed Source record in the database.
   */
  private async ensureResearchSource(
    tx: Prisma.TransactionClient,
    authority?: SourceAuthorityTier,
    sourceUrl?: string,
  ): Promise<string> {
    let code = AI_RESEARCH_SOURCE_CODE;
    let name = 'AI Capital Markets Research Engine';
    let sourceType: SourceType = SourceType.OFFICIAL_FILING;
    let baseUrl = 'https://www.sebi.gov.in';

    const urlLower = (sourceUrl || '').toLowerCase();
    if (urlLower.includes('nseindia.com')) {
      code = 'AI_RESEARCH_NSE';
      name = 'NSE Official AI Research';
      sourceType = SourceType.EXCHANGE;
      baseUrl = 'https://www.nseindia.com';
    } else if (urlLower.includes('bseindia.com')) {
      code = 'AI_RESEARCH_BSE';
      name = 'BSE Official AI Research';
      sourceType = SourceType.EXCHANGE;
      baseUrl = 'https://www.bseindia.com';
    } else if (authority === 'TIER_2_REGISTRAR') {
      code = 'AI_RESEARCH_REGISTRAR';
      name = 'Official Registrar AI Research';
      sourceType = SourceType.REGISTRAR;
      baseUrl = sourceUrl || 'https://linkintime.co.in';
    } else if (authority === 'TIER_3_ISSUER') {
      code = 'AI_RESEARCH_ISSUER';
      name = 'Issuer Prospectus AI Research';
      sourceType = SourceType.OFFICIAL_FILING;
      baseUrl = sourceUrl || 'https://issuer.official';
    }

    const source = await tx.source.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name,
        sourceType,
        baseUrl,
        priority: authority === 'TIER_1_STATUTORY' ? 85 : 75,
        enabled: true,
      },
    });

    return source.id;
  }

  private mapFieldToChangeType(fieldKey: string): IpoChangeType {
    switch (fieldKey) {
      case 'priceBandLow':
      case 'priceBandHigh':
        return IpoChangeType.PRICE_BAND_CHANGED;
      case 'lotSize':
        return IpoChangeType.LOT_SIZE_CHANGED;
      case 'openDate':
        return IpoChangeType.OPEN_DATE_CHANGED;
      case 'closeDate':
        return IpoChangeType.CLOSE_DATE_CHANGED;
      case 'listingDate':
        return IpoChangeType.LISTING_DATE_CHANGED;
      case 'status':
        return IpoChangeType.STATUS_CHANGED;
      case 'issueSize':
      case 'freshIssueSize':
      case 'ofsSize':
        return IpoChangeType.ISSUE_SIZE_CHANGED;
      default:
        return IpoChangeType.FIELD_CHANGED;
    }
  }

  private mapFieldToLifecycleEventType(fieldKey: string): LifecycleEventType | null {
    switch (fieldKey) {
      case 'openDate':
        return LifecycleEventType.OPEN;
      case 'closeDate':
        return LifecycleEventType.CLOSE;
      case 'allotmentDate':
        return LifecycleEventType.BASIS_OF_ALLOTMENT;
      case 'refundDate':
        return LifecycleEventType.REFUND_INITIATION;
      case 'listingDate':
        return LifecycleEventType.LISTING;
      default:
        return null;
    }
  }
}
