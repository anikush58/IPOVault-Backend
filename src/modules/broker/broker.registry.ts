import { Injectable, Logger } from '@nestjs/common';
import { BrokerType } from '@prisma/client';
import { BrokerAdapter } from './broker.adapter';
import { UnsupportedBrokerAdapterException } from './broker.errors';

/**
 * Central registry mapping canonical BrokerType values to their concrete BrokerAdapter instances.
 * Ensures only explicitly registered adapters are accessible and rejects unsupported brokers safely.
 */
@Injectable()
export class BrokerRegistry {
  private readonly logger = new Logger(BrokerRegistry.name);
  private readonly adapters = new Map<BrokerType, BrokerAdapter>();

  /**
   * Registers a concrete BrokerAdapter for a specific BrokerType.
   */
  register(adapter: BrokerAdapter): void {
    if (!adapter || !adapter.brokerType) {
      throw new Error('Invalid broker adapter: brokerType is required');
    }
    this.adapters.set(adapter.brokerType, adapter);
    this.logger.log(`Registered Broker Adapter for: ${adapter.brokerType}`);
  }

  /**
   * Retrieves the registered BrokerAdapter for the given BrokerType.
   * Throws UnsupportedBrokerAdapterException if no adapter is registered.
   */
  getAdapter(broker: BrokerType): BrokerAdapter {
    const adapter = this.adapters.get(broker);
    if (!adapter) {
      throw new UnsupportedBrokerAdapterException(broker);
    }
    return adapter;
  }

  /**
   * Checks if an adapter is currently registered for the specified BrokerType.
   */
  hasAdapter(broker: BrokerType): boolean {
    return this.adapters.has(broker);
  }

  /**
   * Returns a list of all currently registered BrokerTypes.
   */
  getSupportedBrokers(): BrokerType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Returns all registered BrokerAdapter instances.
   */
  getAllAdapters(): BrokerAdapter[] {
    return Array.from(this.adapters.values());
  }
}
