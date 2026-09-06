import { z } from 'zod';
import {
  AllotmentIdentifierType,
  AllotmentJobStatus,
  AllotmentStatus,
  CaptchaChallenge,
} from '../allotment.types';
import { isValidPan } from '../allotment.utils';

export const allotmentIdentifierTypeSchema = z.nativeEnum(
  AllotmentIdentifierType,
);

export const checkAllotmentBodySchema = z
  .object({
    ipoId: z.string().uuid({ message: 'ipoId must be a valid UUID' }),
    identifierType: allotmentIdentifierTypeSchema,
    identifierValue: z
      .string()
      .trim()
      .min(3, { message: 'identifierValue must be at least 3 characters' }),
    captchaToken: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.identifierType === AllotmentIdentifierType.PAN) {
        return isValidPan(data.identifierValue);
      }
      return true;
    },
    {
      message:
        'Invalid PAN format. PAN must be 10 characters (5 letters, 4 digits, 1 letter)',
      path: ['identifierValue'],
    },
  );

export type CheckAllotmentBodyDto = z.infer<typeof checkAllotmentBodySchema>;

export const createAllotmentJobBodySchema = z.object({
  ipoId: z.string().uuid({ message: 'ipoId must be a valid UUID' }),
  identifierType: allotmentIdentifierTypeSchema
    .optional()
    .default(AllotmentIdentifierType.PAN),
  identifierValues: z.array(z.string().trim().min(3)).optional(),
});

export type CreateAllotmentJobBodyDto = z.infer<
  typeof createAllotmentJobBodySchema
>;

export interface AllotmentCheckResponseDto {
  status: AllotmentStatus;
  sharesApplied?: number;
  sharesAllotted?: number;
  allotmentPrice?: number;
  amountApplied?: number;
  amountRefunded?: number;
  applicantName?: string;
  sourceCode: string;
  sourceTimestamp?: string;
  checkedAt: string;
  errorMessage?: string;
  captchaChallenge?: CaptchaChallenge;
}

export interface AllotmentJobItemResponseDto {
  id: string;
  maskedId: string;
  status: string;
  sharesApplied?: number | null;
  sharesAllotted?: number | null;
  errorMessage?: string | null;
  checkedAt?: Date | null;
}

export interface AllotmentJobResponseDto {
  id: string;
  ipoId: string;
  status: AllotmentJobStatus;
  totalChecks: number;
  processedChecks: number;
  successfulChecks: number;
  failedChecks: number;
  progressMessage: string;
  createdAt: Date;
  updatedAt: Date;
  items: AllotmentJobItemResponseDto[];
}
