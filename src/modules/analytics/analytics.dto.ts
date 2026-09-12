import { z } from 'zod';
import { ExchangeListing, IpoStatus, MarketSegment } from '@prisma/client';
import { AnalyticsTimePeriod, AnalyticsDateAnchor } from './analytics.types';

const emptyToUndefined = (value: unknown) =>
  value === '' || value === undefined ? undefined : value;

export const analyticsPeriodSchema = z.nativeEnum(AnalyticsTimePeriod);
export const analyticsDateAnchorSchema = z.nativeEnum(AnalyticsDateAnchor);
export const marketSegmentSchema = z.nativeEnum(MarketSegment);
export const exchangeListingSchema = z.nativeEnum(ExchangeListing);
export const ipoStatusSchema = z.nativeEnum(IpoStatus);

const isoDateStringSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/,
    'Invalid ISO date string (expected YYYY-MM-DD or ISO timestamp)',
  );

export const marketAnalyticsQuerySchema = z
  .object({
    from: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    to: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    segment: z.preprocess(emptyToUndefined, marketSegmentSchema.optional()),
    exchange: z.preprocess(emptyToUndefined, exchangeListingSchema.optional()),
    status: z.preprocess(emptyToUndefined, ipoStatusSchema.optional()),
    period: z.preprocess(emptyToUndefined, analyticsPeriodSchema.optional()),
    anchor: z.preprocess(emptyToUndefined, analyticsDateAnchorSchema.optional()),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: "'from' date must be on or before 'to' date",
      path: ['from'],
    },
  );

export type MarketAnalyticsQueryDto = z.infer<typeof marketAnalyticsQuerySchema>;

export const performanceAnalyticsQuerySchema = z
  .object({
    from: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    to: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    segment: z.preprocess(emptyToUndefined, marketSegmentSchema.optional()),
    exchange: z.preprocess(emptyToUndefined, exchangeListingSchema.optional()),
    status: z.preprocess(emptyToUndefined, ipoStatusSchema.optional()),
    period: z.preprocess(emptyToUndefined, analyticsPeriodSchema.optional()),
    anchor: z.preprocess(emptyToUndefined, analyticsDateAnchorSchema.optional()),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: "'from' date must be on or before 'to' date",
      path: ['from'],
    },
  );

export type PerformanceAnalyticsQueryDto = z.infer<
  typeof performanceAnalyticsQuerySchema
>;

export const subscriptionAnalyticsQuerySchema = z
  .object({
    from: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    to: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    segment: z.preprocess(emptyToUndefined, marketSegmentSchema.optional()),
    exchange: z.preprocess(emptyToUndefined, exchangeListingSchema.optional()),
    status: z.preprocess(emptyToUndefined, ipoStatusSchema.optional()),
    period: z.preprocess(emptyToUndefined, analyticsPeriodSchema.optional()),
    anchor: z.preprocess(emptyToUndefined, analyticsDateAnchorSchema.optional()),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: "'from' date must be on or before 'to' date",
      path: ['from'],
    },
  );

export type SubscriptionAnalyticsQueryDto = z.infer<
  typeof subscriptionAnalyticsQuerySchema
>;

export const allotmentAnalyticsQuerySchema = z
  .object({
    ipoId: z.preprocess(emptyToUndefined, z.string().optional()),
    segment: z.preprocess(emptyToUndefined, marketSegmentSchema.optional()),
    from: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    to: z.preprocess(emptyToUndefined, isoDateStringSchema.optional()),
    period: z.preprocess(emptyToUndefined, analyticsPeriodSchema.optional()),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: "'from' date must be on or before 'to' date",
      path: ['from'],
    },
  );

export type AllotmentAnalyticsQueryDto = z.infer<
  typeof allotmentAnalyticsQuerySchema
>;

export const qualityAnalyticsQuerySchema = z.object({});
export type QualityAnalyticsQueryDto = z.infer<
  typeof qualityAnalyticsQuerySchema
>;
