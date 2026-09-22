import { z } from 'zod';
import { BrokerType } from '@prisma/client';

export const createBrokerAccountSchema = z.object({
  profileId: z
    .string()
    .trim()
    .min(1, { message: 'profileId is required and must not be empty' }),
  broker: z.nativeEnum(BrokerType),
  accountName: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
});

export type CreateBrokerAccountDto = z.infer<typeof createBrokerAccountSchema>;
