import { Injectable } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  BSE_SME_SOURCE_CODE,
  BSE_SOURCE_CODE,
  NSE_EMERGE_SOURCE_CODE,
  NSE_SOURCE_CODE,
  SEBI_SOURCE_CODE,
} from './adapters/source-adapter';

export interface SourceDefinition {
  code: string;
  name: string;
  sourceType: SourceType;
  baseUrl: string;
  priority: number;
  enabled: boolean;
}

export const KNOWN_DISCOVERY_SOURCES: Record<string, SourceDefinition> = {
  [BSE_SME_SOURCE_CODE]: {
    code: BSE_SME_SOURCE_CODE,
    name: 'BSE SME Platform',
    sourceType: SourceType.EXCHANGE,
    baseUrl: 'https://www.bseindia.com',
    priority: 2,
    enabled: true,
  },
  [BSE_SOURCE_CODE]: {
    code: BSE_SOURCE_CODE,
    name: 'Bombay Stock Exchange',
    sourceType: SourceType.EXCHANGE,
    baseUrl: 'https://www.bseindia.com',
    priority: 2,
    enabled: true,
  },
  [NSE_EMERGE_SOURCE_CODE]: {
    code: NSE_EMERGE_SOURCE_CODE,
    name: 'NSE Emerge Platform',
    sourceType: SourceType.EXCHANGE,
    baseUrl: 'https://www.nseindia.com',
    priority: 2,
    enabled: true,
  },
  [NSE_SOURCE_CODE]: {
    code: NSE_SOURCE_CODE,
    name: 'National Stock Exchange of India',
    sourceType: SourceType.EXCHANGE,
    baseUrl: 'https://www.nseindia.com',
    priority: 2,
    enabled: true,
  },
  [SEBI_SOURCE_CODE]: {
    code: SEBI_SOURCE_CODE,
    name: 'Securities and Exchange Board of India (SEBI)',
    sourceType: SourceType.OFFICIAL_FILING,
    baseUrl: 'https://www.sebi.gov.in',
    priority: 1,
    enabled: true,
  },
};

@Injectable()
export class SourceRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures a known discovery source is registered in the database.
   * Idempotent and safe against concurrent executions.
   */
  async ensureSource(code: string) {
    const normalized = code.trim().toLowerCase();
    const definition = KNOWN_DISCOVERY_SOURCES[normalized];
    if (!definition) {
      // Fallback for custom source codes
      return this.prisma.source.upsert({
        where: { code: normalized },
        update: {},
        create: {
          code: normalized,
          name: code,
          sourceType: SourceType.EXCHANGE,
          baseUrl: null,
          priority: 50,
          enabled: true,
        },
      });
    }

    return this.prisma.source.upsert({
      where: { code: definition.code },
      update: {},
      create: {
        code: definition.code,
        name: definition.name,
        sourceType: definition.sourceType,
        baseUrl: definition.baseUrl,
        priority: definition.priority,
        enabled: definition.enabled,
      },
    });
  }

  /**
   * Ensures all known statutory/exchange discovery sources exist.
   */
  async ensureAllDiscoverySources() {
    const results = [];
    for (const code of Object.keys(KNOWN_DISCOVERY_SOURCES)) {
      const source = await this.ensureSource(code);
      results.push(source);
    }
    return results;
  }
}
