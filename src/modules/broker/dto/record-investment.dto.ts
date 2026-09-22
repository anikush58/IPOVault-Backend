import { z } from 'zod';

export const recordAllotmentInvestmentSchema = z.object({
  ipoId: z
    .string()
    .trim()
    .min(1, { message: 'ipoId is required and must not be empty' }),
  isin: z
    .string()
    .trim()
    .min(1, { message: 'isin is required and must not be empty' }),
  allottedQuantity: z
    .number()
    .positive({ message: 'allottedQuantity must be greater than 0' }),
  allotmentPrice: z
    .number()
    .nonnegative({ message: 'allotmentPrice must be non-negative' }),
  allotmentDate: z.string().or(z.date()).optional().nullable(),
  profileId: z.string().trim().optional(),
});

export type RecordAllotmentInvestmentDto = z.infer<
  typeof recordAllotmentInvestmentSchema
>;
