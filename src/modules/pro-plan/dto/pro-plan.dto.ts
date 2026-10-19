import { z } from 'zod';

export const publicationStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type PublicationStatusDto = z.infer<typeof publicationStatusSchema>;

export const proPlanBenefitItemSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, 'Benefit title is required').max(200),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  displayOrder: z.coerce.number().int().default(0),
});
export type ProPlanBenefitItemDto = z.infer<typeof proPlanBenefitItemSchema>;

export const createProPlanSchema = z.object({
  code: z
    .string()
    .min(2, 'Plan code must be at least 2 characters')
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'Plan code must be lowercase alphanumeric, dash or underscore'),
  name: z.string().min(1, 'Plan name is required').max(100),
  description: z.string().max(2000).nullable().optional(),
  duration: z.string().min(1, 'Duration is required').max(50),
  durationDays: z.coerce.number().int().positive().nullable().optional(),
  priceInr: z.coerce.number().min(0, 'Price in INR must be non-negative'),
  comparisonPriceInr: z.coerce.number().min(0).nullable().optional(),
  status: publicationStatusSchema.optional().default('DRAFT'),
  displayOrder: z.coerce.number().int().default(0),
  isPopular: z.boolean().optional().default(false),
  badge: z.string().max(50).nullable().optional(),
  features: z.array(z.string()).optional().default([]),
  benefits: z.array(proPlanBenefitItemSchema).optional().default([]),
});
export const updateProPlanSchema = createProPlanSchema.partial();

export interface CreateProPlanDto {

  code: string;
  name: string;
  description?: string | null;
  duration: string;
  durationDays?: number | null;
  priceInr: number;
  comparisonPriceInr?: number | null;
  status?: PublicationStatusDto;
  displayOrder?: number;
  isPopular?: boolean;
  badge?: string | null;
  features?: string[];
  benefits?: ProPlanBenefitItemDto[];
}

export type UpdateProPlanDto = Partial<CreateProPlanDto>;



export const proPlanQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(['ALL', 'DRAFT', 'PUBLISHED', 'ARCHIVED']).optional().default('ALL'),
});
export type ProPlanQueryDto = z.infer<typeof proPlanQuerySchema>;

/**
 * Mobile-safe public representation of a published Pro Plan.
 * Never leaks administrative metadata, user entitlement details, or internal draft states.
 */
export interface MobileProPlanResponse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  duration: string;
  durationDays: number | null;
  priceInr: number;
  comparisonPriceInr: number | null;
  isPopular: boolean;
  badge: string | null;
  displayOrder: number;
  features: string[];
  benefits: {
    id: string;
    title: string;
    description: string | null;
    icon: string | null;
    displayOrder: number;
  }[];
}
