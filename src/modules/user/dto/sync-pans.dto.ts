import { z } from 'zod';
import { isValidPan } from '../../allotment/allotment.utils';

export const syncPanItemSchema = z.object({
  pan: z.string().trim().refine(isValidPan, {
    message: 'Invalid PAN format',
  }),
  name: z.string().trim().optional(),
});

export const syncPansBodySchema = z.object({
  pans: z
    .array(syncPanItemSchema)
    .min(1, { message: 'pans must contain at least one item' }),
});

export type SyncPansBodyDto = z.infer<typeof syncPansBodySchema>;
