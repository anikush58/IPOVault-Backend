import { Module } from '@nestjs/common';

import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { MatchingService } from './matching.service';
import { NseHttpClient } from './adapters/nse/nse.fetcher';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';
import { NseDiscoveryFlow } from './nse-discovery.flow';
import { SebiHttpClient } from './adapters/sebi/sebi.fetcher';
import { SebiSourceAdapter } from './adapters/sebi/sebi.adapter';
import { SebiDiscoveryFlow } from './adapters/sebi/sebi-discovery.flow';

import { ReconciliationService } from './reconciliation.service';
import { DiscoveryFreshnessService } from './discovery-freshness.service';
import { DiscoveryRefreshService } from './discovery-refresh.service';
import { DiscoveryRefreshExecutionService } from './discovery-refresh-execution.service';
import { DiscoveryRefreshVerificationService } from './discovery-refresh-verification.service';
import { DiscoverySmartRefreshService } from './discovery-smart-refresh.service';
import { DiscoveryCoverageService } from './discovery-coverage.service';
import { DiscoveryQualityGateService } from './discovery-quality-gate.service';
import { DiscoverySchedulerService } from './discovery-scheduler.service';

import { SmeDocumentMatcherService } from './adapters/sebi/sme-document-matcher.service';
import { SebiDocumentMatcherService } from './adapters/sebi/sebi-document-matcher.service';
import { SebiDocumentRetrievalService } from './adapters/sebi/sebi-document-retrieval.service';
import { SourceRegistryService } from './source-registry.service';
import { SmeSourceAdapter } from './adapters/sme/sme-discovery.adapter';
import { SmeDiscoveryFetcher } from './adapters/sme/sme-discovery.fetcher';
import { SmeDiscoveryFlow } from './adapters/sme/sme-discovery.flow';

@Module({
  providers: [
    SourceRegistryService,
    DiscoveryRecordRepository,
    MatchingService,
    CanonicalizerService,
    DiscoveryFreshnessService,
    DiscoveryRefreshService,
    DiscoveryRefreshExecutionService,
    DiscoveryRefreshVerificationService,
    DiscoverySmartRefreshService,
    DiscoveryCoverageService,
    DiscoveryQualityGateService,
    DiscoverySchedulerService,
    ReconciliationService,
    DiscoveryService,
    NseSourceAdapter,
    NseHttpClient,
    NseDiscoveryFlow,
    SebiSourceAdapter,
    SebiHttpClient,
    SebiDiscoveryFlow,
    SmeSourceAdapter,
    SmeDiscoveryFetcher,
    SmeDiscoveryFlow,
    SmeDocumentMatcherService,
    SebiDocumentMatcherService,
    SebiDocumentRetrievalService,
  ],
  exports: [
    SourceRegistryService,
    DiscoveryService,
    DiscoveryFreshnessService,
    DiscoveryRefreshService,
    DiscoveryRefreshExecutionService,
    DiscoveryRefreshVerificationService,
    DiscoverySmartRefreshService,
    DiscoveryCoverageService,
    DiscoveryQualityGateService,
    DiscoverySchedulerService,
    ReconciliationService,
    NseSourceAdapter,
    NseHttpClient,
    NseDiscoveryFlow,
    SebiSourceAdapter,
    SebiHttpClient,
    SebiDiscoveryFlow,
    SmeSourceAdapter,
    SmeDiscoveryFetcher,
    SmeDiscoveryFlow,
    SmeDocumentMatcherService,
    SebiDocumentMatcherService,
    SebiDocumentRetrievalService,
  ],
})
export class DiscoveryModule {}
