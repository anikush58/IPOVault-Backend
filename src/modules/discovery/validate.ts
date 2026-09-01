import { z } from 'zod';

import { DiscoveredIpo } from './discovery.types';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const discoveredIpoSchema = z
  .object({
    company: z.object({
      legalName: z.string().min(1),
      displayName: z.string().min(1).nullable(),
      cin: z.string().min(1).nullable(),
    }),
    ipo: z.object({
      marketSegment: z.enum(['MAINBOARD', 'SME']),
      exchange: z.enum(['NSE', 'BSE', 'BOTH']),
      status: z
        .enum([
          'DRAFT',
          'UPCOMING',
          'OPEN',
          'CLOSED',
          'ALLOTMENT_PENDING',
          'ALLOTMENT_COMPLETED',
          'LISTING_PENDING',
          'LISTED',
          'WITHDRAWN',
          'CANCELLED',
        ])
        .nullable(),
      symbol: z.string().min(1).nullable(),
      issueSize: z.string().nullable(),
      freshIssueSize: z.string().nullable(),
      ofsSize: z.string().nullable(),
      faceValue: z.string().nullable(),
      priceBandLow: z.string().nullable(),
      priceBandHigh: z.string().nullable(),
      lotSize: z.number().int().positive().nullable(),
      minimumLots: z.number().int().positive().nullable(),
    }),
    lifecycle: z.object({
      drhpDate: dateSchema,
      rhpDate: dateSchema,
      anchorDate: dateSchema,
      openDate: dateSchema,
      closeDate: dateSchema,
      basisOfAllotmentDate: dateSchema,
      refundInitiationDate: dateSchema,
      dematCreditDate: dateSchema,
      listingDate: dateSchema,
    }),
    source: z.object({
      externalId: z.string().min(1).nullable(),
      reference: z.string().min(1).nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    const low = value.ipo.priceBandLow ? Number(value.ipo.priceBandLow) : null;
    const high = value.ipo.priceBandHigh
      ? Number(value.ipo.priceBandHigh)
      : null;

    if (low !== null && !(low > 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'priceBandLow must be positive',
      });
    }

    if (high !== null && !(high > 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'priceBandHigh must be positive',
      });
    }

    if (low !== null && high !== null && low > high) {
      ctx.addIssue({
        code: 'custom',
        message: 'priceBandLow must be <= priceBandHigh',
      });
    }

    if (
      value.lifecycle.openDate &&
      value.lifecycle.closeDate &&
      value.lifecycle.openDate > value.lifecycle.closeDate
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'openDate must be on or before closeDate',
      });
    }
  });

export function validateDiscoveredIpo(
  discovered: DiscoveredIpo,
): { ok: true } | { ok: false; message: string } {
  const result = discoveredIpoSchema.safeParse(discovered);

  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? 'invalid discovery',
    };
  }

  return { ok: true };
}
