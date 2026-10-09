import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  encryptPan,
  hashIdentifier,
  maskIdentifier,
} from '../allotment/allotment.utils';
import { AllotmentIdentifierType } from '../allotment/allotment.types';
import { SyncPansBodyDto } from './dto/sync-pans.dto';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncPans(userId: string, dto: SyncPansBodyDto) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const results = [];
    for (const item of dto.pans) {
      const panUpper = item.pan.trim().toUpperCase();
      const panHash = hashIdentifier(panUpper);
      const panEncrypted = encryptPan(panUpper);
      const panMasked = maskIdentifier(panUpper, AllotmentIdentifierType.PAN);

      const existing = await this.prisma.userSavedPan.findFirst({
        where: {
          userId: cleanUserId,
          panHash,
        },
      });

      if (existing) {
        const updated = await this.prisma.userSavedPan.update({
          where: { id: existing.id },
          data: {
            name: item.name || existing.name,
            panEncrypted,
            panMasked,
            updatedAt: new Date(),
          },
        });
        results.push({ id: updated.id, maskedPan: updated.panMasked });
      } else {
        const created = await this.prisma.userSavedPan.create({
          data: {
            userId: cleanUserId,
            panHash,
            panEncrypted,
            panMasked,
            name: item.name || null,
          },
        });
        results.push({ id: created.id, maskedPan: created.panMasked });
      }
    }

    this.logger.log(
      `Synchronized ${results.length} saved PANs for user ${cleanUserId}`,
    );

    return {
      syncedCount: results.length,
      pans: results,
    };
  }

  /**
   * Deletes a specific saved PAN record owned by the authenticated user.
   * Rejects cross-user deletion attempts with 404.
   */
  async deletePan(userId: string, panId: string) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const existing = await this.prisma.userSavedPan.findUnique({
      where: { id: panId },
    });

    if (!existing || existing.userId !== cleanUserId) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Saved PAN with ID '${panId}' was not found`,
        404,
      );
    }

    await this.prisma.userSavedPan.delete({
      where: { id: panId },
    });

    this.logger.log(`Deleted saved PAN ${panId} for user ${cleanUserId}`);

    return {
      success: true,
      id: panId,
      deleted: true,
    };
  }

  /**
   * Deletes all saved PAN records belonging to the authenticated user.
   */
  async deleteAllPans(userId: string) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const result = await this.prisma.userSavedPan.deleteMany({
      where: { userId: cleanUserId },
    });

    this.logger.log(
      `Deleted all ${result.count} saved PANs for user ${cleanUserId}`,
    );

    return {
      success: true,
      deletedCount: result.count,
    };
  }
}
