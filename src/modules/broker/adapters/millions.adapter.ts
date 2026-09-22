import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrokerType } from '@prisma/client';
import { Env } from '../../../config/env';
import { DhanBrokerAdapter } from './dhan.adapter';

/**
 * Millions by Dhan Broker Adapter.
 * Millions is Dhan's investment platform running directly on DhanHQ API infrastructure.
 * Reuses the entire DhanBrokerAdapter implementation for OAuth/consent, holdings,
 * trades, quotes, and token lifecycle without duplicate broker-specific logic.
 */
@Injectable()
export class MillionsBrokerAdapter extends DhanBrokerAdapter {
  override readonly brokerType: BrokerType = BrokerType.MILLIONS;

  constructor(@Optional() configService?: ConfigService<Env, true>) {
    super(configService);
  }
}
