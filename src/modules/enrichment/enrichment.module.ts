import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AiStructuredExtractorService } from './ai/ai-structured-extractor.service';
import { EnrichmentOrchestratorService } from './enrichment-orchestrator.service';
import { EnrichmentValidatorService } from './enrichment-validator.service';
import { MissingFieldDetectorService } from './missing-field-detector.service';

import { AiResearchAgentService } from './research/ai-research-agent.service';
import { AiResearchReconciliationService } from './research/ai-research-reconciliation.service';
import { AiResearchOrchestratorService } from './research/ai-research-orchestrator.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule, ConfigModule],
  providers: [
    MissingFieldDetectorService,
    AiStructuredExtractorService,
    EnrichmentValidatorService,
    EnrichmentOrchestratorService,
    AiResearchAgentService,
    AiResearchReconciliationService,
    AiResearchOrchestratorService,
  ],
  exports: [
    MissingFieldDetectorService,
    AiStructuredExtractorService,
    EnrichmentValidatorService,
    EnrichmentOrchestratorService,
    AiResearchAgentService,
    AiResearchReconciliationService,
    AiResearchOrchestratorService,
  ],
})
export class EnrichmentModule {}
