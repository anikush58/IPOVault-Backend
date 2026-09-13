import { Prisma } from '@prisma/client';

import {
  FieldProvenanceWithSource,
  getCanonicalValue,
  getPublicFieldName,
  toIpoLineageResponseDto,
} from './ipo.mapper';
import { IpoWithRelations } from './ipo.types';

describe('Phase 24 — Field-Level IPO Data Lineage & Provenance', () => {
  const ipoId = '11111111-1111-1111-1111-111111111111';
  const companyId = '22222222-2222-2222-2222-222222222222';

  const mockSourceSebi = {
    id: 'src-sebi',
    code: 'sebi',
    name: 'SEBI Official Filing',
    sourceType: 'OFFICIAL_FILING' as const,
    baseUrl: 'https://sebi.gov.in',
    priority: 10,
    enabled: true,
    parserType: 'pdf',
    parserVersion: '1.0',
    rateLimitPolicy: null,
    authenticationRequired: false,
    healthStatus: 'HEALTHY' as const,
    lastSuccessAt: new Date(),
    lastFailureAt: null,
    lastCheckedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSourceNse = {
    id: 'src-nse',
    code: 'nse',
    name: 'National Stock Exchange',
    sourceType: 'EXCHANGE' as const,
    baseUrl: 'https://nseindia.com',
    priority: 20,
    enabled: true,
    parserType: 'json',
    parserVersion: '1.0',
    rateLimitPolicy: null,
    authenticationRequired: false,
    healthStatus: 'HEALTHY' as const,
    lastSuccessAt: new Date(),
    lastFailureAt: null,
    lastCheckedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockIpo: IpoWithRelations = {
    id: ipoId,
    companyId,
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    status: 'OPEN',
    publicationStatus: 'PUBLISHED',
    symbol: 'ACME',
    issueSize: new Prisma.Decimal('500.00'),
    freshIssueSize: new Prisma.Decimal('300.00'),
    ofsSize: new Prisma.Decimal('200.00'),
    issueShareCount: new Prisma.Decimal('1000000'),
    freshIssueShareCount: new Prisma.Decimal('600000'),
    ofsShareCount: new Prisma.Decimal('400000'),
    faceValue: new Prisma.Decimal('10.00'),
    priceBandLow: new Prisma.Decimal('175.00'),
    priceBandHigh: new Prisma.Decimal('180.00'),
    lotSize: 100,
    minimumLots: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    company: {
      id: companyId,
      legalName: 'Acme Corporation Limited',
      displayName: 'Acme Corp',
      cin: 'L12345MH2020PLC123456',
      website: 'https://acme.com',
      industry: 'Technology',
      sector: 'IT',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    lifecycleEvents: [
      {
        id: 'evt-open',
        ipoId,
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: 'doc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'evt-close',
        ipoId,
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-12T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: 'doc-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };

  const sampleProvenances: FieldProvenanceWithSource[] = [
    {
      id: 'prov-1',
      entityType: 'COMPANY',
      entityId: companyId,
      fieldName: 'legal_name',
      value: 'Acme Corporation Limited',
      sourceId: 'src-sebi',
      sourceReference: 'rhp-1',
      retrievedAt: new Date('2026-09-05T08:00:00.000Z'),
      confidence: new Prisma.Decimal('1.000'),
      createdAt: new Date('2026-09-05T08:00:00.000Z'),
      source: mockSourceSebi,
    },
    {
      id: 'prov-2',
      entityType: 'IPO',
      entityId: ipoId,
      fieldName: 'price_band_low',
      value: '175.00',
      sourceId: 'src-sebi',
      sourceReference: 'rhp-1',
      retrievedAt: new Date('2026-09-05T08:00:00.000Z'),
      confidence: new Prisma.Decimal('1.000'),
      createdAt: new Date('2026-09-05T08:00:00.000Z'),
      source: mockSourceSebi,
    },
    {
      id: 'prov-3',
      entityType: 'IPO',
      entityId: ipoId,
      fieldName: 'price_band_low',
      value: '175.00',
      sourceId: 'src-nse',
      sourceReference: 'nse-api-1',
      retrievedAt: new Date('2026-09-06T09:00:00.000Z'),
      confidence: new Prisma.Decimal('1.000'),
      createdAt: new Date('2026-09-06T09:00:00.000Z'),
      source: mockSourceNse,
    },
    {
      id: 'prov-4',
      entityType: 'IPO',
      entityId: ipoId,
      fieldName: 'lifecycle.open_date',
      value: '2026-09-10',
      sourceId: 'src-sebi',
      sourceReference: 'rhp-1',
      retrievedAt: new Date('2026-09-05T08:00:00.000Z'),
      confidence: new Prisma.Decimal('1.000'),
      createdAt: new Date('2026-09-05T08:00:00.000Z'),
      source: mockSourceSebi,
    },
  ];

  describe('Field Name & Canonical Value Mapping', () => {
    it('maps snake_case storage field names to public camelCase field names', () => {
      expect(getPublicFieldName('legal_name')).toBe('company.legalName');
      expect(getPublicFieldName('cin')).toBe('company.cin');
      expect(getPublicFieldName('price_band_low')).toBe('priceBandLow');
      expect(getPublicFieldName('price_band_high')).toBe('priceBandHigh');
      expect(getPublicFieldName('lot_size')).toBe('lotSize');
      expect(getPublicFieldName('lifecycle.open_date')).toBe('openDate');
      expect(getPublicFieldName('lifecycle.close_date')).toBe('closeDate');
      expect(getPublicFieldName('lifecycle.listing_date')).toBe('listingDate');
    });

    it('extracts canonical values from IpoWithRelations correctly', () => {
      expect(getCanonicalValue(mockIpo, 'company.legalName')).toBe(
        'Acme Corporation Limited',
      );
      expect(getCanonicalValue(mockIpo, 'priceBandLow')).toBe('175.00');
      expect(getCanonicalValue(mockIpo, 'priceBandHigh')).toBe('180.00');
      expect(getCanonicalValue(mockIpo, 'lotSize')).toBe('100');
      expect(getCanonicalValue(mockIpo, 'openDate')).toBe('2026-09-10');
      expect(getCanonicalValue(mockIpo, 'closeDate')).toBe('2026-09-12');
      expect(getCanonicalValue(mockIpo, 'listingDate')).toBeNull();
    });
  });

  describe('Lineage DTO Transformation', () => {
    it('returns empty fields array when given no field provenance records', () => {
      const result = toIpoLineageResponseDto(ipoId, mockIpo, []);
      expect(result).toEqual({
        ipoId,
        fields: [],
      });
    });

    it('transforms field provenances into deterministic public lineage DTO', () => {
      const result = toIpoLineageResponseDto(ipoId, mockIpo, sampleProvenances);

      expect(result.ipoId).toBe(ipoId);
      expect(result.fields).toHaveLength(3);

      // Deterministic field order check: company.legalName -> priceBandLow -> openDate
      expect(result.fields[0]!.fieldName).toBe('company.legalName');
      expect(result.fields[0]!.canonicalValue).toBe('Acme Corporation Limited');
      expect(result.fields[0]!.source).toEqual({
        code: 'sebi',
        name: 'SEBI Official Filing',
        sourceType: 'OFFICIAL_FILING',
      });
      expect(result.fields[0]!.observedValue).toBe('Acme Corporation Limited');
      expect(result.fields[0]!.observedAt).toBe('2026-09-05T08:00:00.000Z');

      // Check priceBandLow with multiple source observations
      const priceBandLowField = result.fields.find(
        (f) => f.fieldName === 'priceBandLow',
      );
      expect(priceBandLowField).toBeDefined();
      expect(priceBandLowField!.canonicalValue).toBe('175.00');
      expect(priceBandLowField!.observations).toHaveLength(2);

      // Latest observation (NSE on 2026-09-06) should be primary
      expect(priceBandLowField!.source?.code).toBe('nse');
      expect(priceBandLowField!.observedAt).toBe('2026-09-06T09:00:00.000Z');

      // Check that sensitive source data (baseUrl, rateLimitPolicy, parserType) is NOT exposed
      const obsSource = priceBandLowField!.observations[0]!.source as Record<
        string,
        unknown
      >;
      expect(obsSource).toHaveProperty('code');
      expect(obsSource).toHaveProperty('name');
      expect(obsSource).toHaveProperty('sourceType');
      expect(obsSource).not.toHaveProperty('baseUrl');
      expect(obsSource).not.toHaveProperty('rateLimitPolicy');
    });

    it('filters by field name (supporting both public camelCase and db snake_case)', () => {
      const byCamel = toIpoLineageResponseDto(ipoId, mockIpo, sampleProvenances, {
        field: 'priceBandLow',
      });
      expect(byCamel.fields).toHaveLength(1);
      expect(byCamel.fields[0]!.fieldName).toBe('priceBandLow');

      const bySnake = toIpoLineageResponseDto(ipoId, mockIpo, sampleProvenances, {
        field: 'price_band_low',
      });
      expect(bySnake.fields).toHaveLength(1);
      expect(bySnake.fields[0]!.fieldName).toBe('priceBandLow');
    });

    it('filters by source code', () => {
      const bySource = toIpoLineageResponseDto(ipoId, mockIpo, sampleProvenances, {
        source: 'nse',
      });
      expect(bySource.fields).toHaveLength(1);
      expect(bySource.fields[0]!.fieldName).toBe('priceBandLow');
      expect(bySource.fields[0]!.observations).toHaveLength(1);
      expect(bySource.fields[0]!.observations[0]!.source.code).toBe('nse');
    });

    it('does NOT fabricate canonicalValue when canonical record has null, preserving null', () => {
      const ipoWithoutPriceBand: IpoWithRelations = {
        ...mockIpo,
        priceBandLow: null,
      };

      const result = toIpoLineageResponseDto(
        ipoId,
        ipoWithoutPriceBand,
        sampleProvenances,
        { field: 'priceBandLow' },
      );

      expect(result.fields).toHaveLength(1);
      expect(result.fields[0]!.canonicalValue).toBeNull();
      expect(result.fields[0]!.observedValue).toBe('175.00');
    });

    it('resolves historical observations per source using the latest retrievedAt timestamp', () => {
      const historicalProvenances: FieldProvenanceWithSource[] = [
        {
          id: 'prov-old',
          entityType: 'IPO',
          entityId: ipoId,
          fieldName: 'price_band_low',
          value: '160.00',
          sourceId: 'src-sebi',
          sourceReference: 'drhp-1',
          retrievedAt: new Date('2026-09-01T08:00:00.000Z'),
          confidence: new Prisma.Decimal('1.000'),
          createdAt: new Date('2026-09-01T08:00:00.000Z'),
          source: mockSourceSebi,
        },
        {
          id: 'prov-new',
          entityType: 'IPO',
          entityId: ipoId,
          fieldName: 'price_band_low',
          value: '175.00',
          sourceId: 'src-sebi',
          sourceReference: 'rhp-1',
          retrievedAt: new Date('2026-09-05T08:00:00.000Z'),
          confidence: new Prisma.Decimal('1.000'),
          createdAt: new Date('2026-09-05T08:00:00.000Z'),
          source: mockSourceSebi,
        },
      ];

      const result = toIpoLineageResponseDto(
        ipoId,
        mockIpo,
        historicalProvenances,
      );

      expect(result.fields).toHaveLength(1);
      expect(result.fields[0]!.observations).toHaveLength(1);
      expect(result.fields[0]!.observedValue).toBe('175.00');
      expect(result.fields[0]!.observedAt).toBe('2026-09-05T08:00:00.000Z');
    });
  });
});
