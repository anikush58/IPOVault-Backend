import { BadRequestException } from '@nestjs/common';
import { BrokerType } from '@prisma/client';

/**
 * Thrown when an operation is attempted with an unregistered or unsupported broker type.
 * Never leaks sensitive credentials, API keys, or tokens.
 */
export class UnsupportedBrokerAdapterException extends BadRequestException {
  constructor(broker: BrokerType | string) {
    super(`Broker adapter for '${broker}' is not supported or registered`);
    this.name = 'UnsupportedBrokerAdapterException';
  }
}
