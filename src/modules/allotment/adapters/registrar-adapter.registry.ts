import { Injectable, Logger } from '@nestjs/common';
import { IRegistrarAdapter } from '../allotment.types';

@Injectable()
export class RegistrarAdapterRegistry {
  private readonly logger = new Logger(RegistrarAdapterRegistry.name);
  private readonly adapters = new Map<string, IRegistrarAdapter>();

  register(adapter: IRegistrarAdapter): void {
    const code = adapter.code.toUpperCase();
    if (this.adapters.has(code)) {
      this.logger.warn(`Overwriting registrar adapter for code '${code}'`);
    }
    this.adapters.set(code, adapter);

    // Register alias for legacy identity if applicable
    if (code === 'MUFG_INTIME') {
      this.adapters.set('LINKINTIME', adapter);
    }

    this.logger.log(`Registered Registrar Adapter: ${adapter.name} (${code})`);
  }

  get(code: string): IRegistrarAdapter | undefined {
    return this.adapters.get(code.toUpperCase());
  }

  has(code: string): boolean {
    return this.adapters.has(code.toUpperCase());
  }

  getAll(): IRegistrarAdapter[] {
    const unique = new Set(this.adapters.values());
    return Array.from(unique);
  }
}
