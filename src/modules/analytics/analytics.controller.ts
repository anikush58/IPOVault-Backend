import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AllotmentAnalyticsQueryDto,
  allotmentAnalyticsQuerySchema,
  MarketAnalyticsQueryDto,
  marketAnalyticsQuerySchema,
  PerformanceAnalyticsQueryDto,
  performanceAnalyticsQuerySchema,
  SubscriptionAnalyticsQueryDto,
  subscriptionAnalyticsQuerySchema,
} from './analytics.dto';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsSummaryResponseDto,
  DetailedAllotmentAnalyticsResponseDto,
  DetailedAnalyticsQualitySummaryResponseDto,
  DetailedIpoMarketAnalyticsResponseDto,
  DetailedIpoPerformanceAnalyticsResponseDto,
  DetailedSubscriptionDemandAnalyticsResponseDto,
  MetricContract,
} from './analytics.types';

/**
 * AnalyticsController
 *
 * Phase 30.7 — Canonical Analytics REST API Surface.
 * Exposes read-only analytics capabilities under /api/v1/analytics.
 *
 * Endpoints:
 *   - GET /api/v1/analytics/market
 *   - GET /api/v1/analytics/performance
 *   - GET /api/v1/analytics/subscription
 *   - GET /api/v1/analytics/allotment
 *   - GET /api/v1/analytics/quality
 *   - GET /api/v1/analytics/summary
 *   - GET /api/v1/analytics/metrics
 *   - GET /api/v1/analytics/contracts
 *
 * Guarantees:
 *   - Read-only queries only.
 *   - No mutations or side-effects.
 *   - Zero PAN or encrypted identifier exposure.
 *   - Zero raw payload or credential exposure.
 *   - Thin consumer boundary delegating strictly to AnalyticsService.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /api/v1/analytics/market
   * Aggregates canonical IPO Market counts, status/segment/exchange distributions, and issue size metrics.
   */
  @Get('market')
  async getMarketAnalytics(
    @Query(new ZodValidationPipe(marketAnalyticsQuerySchema))
    query: MarketAnalyticsQueryDto,
  ): Promise<DetailedIpoMarketAnalyticsResponseDto> {
    return this.analyticsService.getDetailedMarketAnalytics(query);
  }

  /**
   * GET /api/v1/analytics/performance
   * Aggregates price band spread metrics and close-to-listing timeline duration metrics.
   */
  @Get('performance')
  async getPerformanceAnalytics(
    @Query(new ZodValidationPipe(performanceAnalyticsQuerySchema))
    query: PerformanceAnalyticsQueryDto,
  ): Promise<DetailedIpoPerformanceAnalyticsResponseDto> {
    return this.analyticsService.getIpoPerformanceAnalytics(query);
  }

  /**
   * GET /api/v1/analytics/subscription
   * Reports subscription demand analytics status. Explicitly returns FUTURE_DATA_DEPENDENT unavailable status.
   */
  @Get('subscription')
  async getSubscriptionAnalytics(
    @Query(new ZodValidationPipe(subscriptionAnalyticsQuerySchema))
    query: SubscriptionAnalyticsQueryDto,
  ): Promise<DetailedSubscriptionDemandAnalyticsResponseDto> {
    return this.analyticsService.getSubscriptionDemandAnalytics(query);
  }

  /**
   * GET /api/v1/analytics/allotment
   * Aggregates descriptive sample allotment check outcome rates and period trends.
   */
  @Get('allotment')
  async getAllotmentAnalytics(
    @Query(new ZodValidationPipe(allotmentAnalyticsQuerySchema))
    query: AllotmentAnalyticsQueryDto,
  ): Promise<DetailedAllotmentAnalyticsResponseDto> {
    return this.analyticsService.getAllotmentAnalytics(query);
  }

  /**
   * GET /api/v1/analytics/quality
   * Exposes unified data-quality telemetry across Completeness, Freshness, Provenance, Source Health, and Quality Gates.
   */
  @Get('quality')
  async getQualityAnalytics(): Promise<DetailedAnalyticsQualitySummaryResponseDto> {
    return this.analyticsService.getAnalyticsQualitySummary();
  }

  /**
   * GET /api/v1/analytics/summary
   * Exposes lightweight mobile-friendly summary snapshot of market, performance, subscription availability, allotment observations, and quality status.
   */
  @Get('summary')
  async getAnalyticsSummary(): Promise<AnalyticsSummaryResponseDto> {
    return this.analyticsService.getAnalyticsSummary();
  }

  /**
   * GET /api/v1/analytics/metrics
   * Alias endpoint exposing metric definitions registry and availability contracts.
   */
  @Get('metrics')
  async getMetricRegistry(): Promise<Record<string, MetricContract>> {
    return this.analyticsService.getMetricContracts();
  }

  /**
   * GET /api/v1/analytics/contracts
   * Exposes metric definitions registry and availability contracts.
   */
  @Get('contracts')
  async getMetricContracts(): Promise<Record<string, MetricContract>> {
    return this.analyticsService.getMetricContracts();
  }
}
