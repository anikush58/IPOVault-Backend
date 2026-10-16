import { z } from 'zod';

export const userAccessTierSchema = z.enum(['NON_PRO', 'PRO']);
export type UserAccessTierDto = z.infer<typeof userAccessTierSchema>;

export const updateUserEntitlementSchema = z.object({
  tier: userAccessTierSchema,
  reason: z.string().max(500).optional(),
});
export type UpdateUserEntitlementDto = z.infer<typeof updateUserEntitlementSchema>;

export const userListQuerySchema = z.object({
  q: z.string().optional(),
  tier: z.enum(['ALL', 'PRO', 'NON_PRO']).optional().default('ALL'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type UserListQueryDto = z.infer<typeof userListQuerySchema>;
