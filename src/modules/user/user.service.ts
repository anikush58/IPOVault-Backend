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
    if (!userId) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication identity required (x-user-id)',
        401,
      );
    }

    const results = [];
    for (const item of dto.pans) {
      const panUpper = item.pan.trim().toUpperCase();
      const panHash = hashIdentifier(panUpper);
      const panEncrypted = encryptPan(panUpper);
      const panMasked = maskIdentifier(panUpper, AllotmentIdentifierType.PAN);

      const existing = await this.prisma.userSavedPan.findFirst({
        where: {
          userId,
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
            userId,
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
      `Synchronized ${results.length} saved PANs for user ${userId}`,
    );

    return {
      syncedCount: results.length,
      pans: results,
    };
  }
}
