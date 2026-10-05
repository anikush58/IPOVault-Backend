import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AiStructuredExtractorService } from './ai/ai-structured-extractor.service';
import { EnrichmentOrchestratorService } from './enrichment-orchestrator.service';
import { EnrichmentValidatorService } from './enrichment-validator.service';
import { MissingFieldDetectorService } from './missing-field-detector.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule, ConfigModule],
  providers: [
    MissingFieldDetectorService,
    AiStructuredExtractorService,
    EnrichmentValidatorService,
    EnrichmentOrchestratorService,
  ],
  exports: [
    MissingFieldDetectorService,
    AiStructuredExtractorService,
    EnrichmentValidatorService,
    EnrichmentOrchestratorService,
  ],
})
export class EnrichmentModule {}
