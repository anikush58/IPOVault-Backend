import { Injectable, Logger } from '@nestjs/common';
import { IRegistrarAdapter } from '../allotment.types';

/**
 * Deterministically normalizes registrar names, display names, and codes to canonical adapter codes.
 */
export function normalizeRegistrarCode(rawCode?: string | null): string {
  if (!rawCode) return '';
  const trimmed = rawCode.trim().toUpperCase();
  const clean = trimmed.replace(/[^A-Z0-9]/g, '');

  if (clean.includes('KFIN') || clean.includes('KARVY')) {
    return 'KFINTECH';
  }

  if (
    clean.includes('MUFG') ||
    clean.includes('LINKINTIME') ||
    (clean.includes('LINK') && clean.includes('INTIME'))
  ) {
    return 'MUFG_INTIME';
  }

  if (clean.includes('MAASHITLA')) {
    return 'MAASHITLA';
  }

  if (clean.includes('SKYLINE')) {
    return 'SKYLINE';
  }

  if (clean.includes('PURVA')) {
    return 'PURVA';
  }

  if (clean.includes('BIGSHARE')) {
    return 'BIGSHARE';
  }

  if (clean.includes('CAMEO')) {
    return 'CAMEO';
  }

  return trimmed;
}

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

    // Register aliases for common registrar codes
    if (code === 'KFINTECH' || code === 'KFIN') {
      this.adapters.set('KFIN', adapter);
      this.adapters.set('KFINTECH', adapter);
      this.adapters.set('KFIN_TECH', adapter);
      this.adapters.set('KFIN TECHNOLOGIES', adapter);
      this.adapters.set('KFIN_TECHNOLOGIES', adapter);
      this.adapters.set('KFIN TECHNOLOGIES LIMITED', adapter);
      this.adapters.set('KFIN_TECHNOLOGIES_LIMITED', adapter);
      this.adapters.set('KFIN TECHNOLOGIES LTD', adapter);
      this.adapters.set('KFIN TECHNOLOGIES LTD.', adapter);
      this.adapters.set('KFIN_TECHNOLOGIES_LTD', adapter);
      this.adapters.set('KFIN_TECHNOLOGIES_LTD.', adapter);
      this.adapters.set('KFIN TECHNOLOGIES PVT LTD', adapter);
      this.adapters.set('KFIN_TECHNOLOGIES_PVT_LTD', adapter);
      this.adapters.set('KFIN TECHNOLOGIES PRIVATE LIMITED', adapter);
      this.adapters.set('KFIN_TECHNOLOGIES_PRIVATE_LIMITED', adapter);
      this.adapters.set('KARVY', adapter);
    }
    if (code === 'MUFG_INTIME' || code === 'LINKINTIME') {
      this.adapters.set('MUFG_INTIME', adapter);
      this.adapters.set('LINKINTIME', adapter);
      this.adapters.set('LINK_INTIME', adapter);
      this.adapters.set('LINK INTIME', adapter);
      this.adapters.set('MUFG', adapter);
      this.adapters.set('MUFG INTIME', adapter);
      this.adapters.set('MUFG INTIME INDIA', adapter);
      this.adapters.set('MUFG INTIME INDIA (FORMERLY LINK INTIME)', adapter);
      this.adapters.set('MUFG INTIME INDIA PRIVATE LIMITED', adapter);
      this.adapters.set('MUFG INTIME INDIA PVT LTD', adapter);
      this.adapters.set('MUFG INTIME INDIA PVT. LTD.', adapter);
      this.adapters.set('MUFG INTIME INDIA LTD', adapter);
      this.adapters.set('MUFG INTIME INDIA LTD.', adapter);
      this.adapters.set('MUFG INTIME INDIA LIMITED', adapter);
      this.adapters.set('LINK INTIME INDIA PRIVATE LIMITED', adapter);
      this.adapters.set('LINK INTIME INDIA PVT LTD', adapter);
      this.adapters.set('LINK INTIME INDIA PVT. LTD.', adapter);
      this.adapters.set('LINK INTIME INDIA LTD', adapter);
      this.adapters.set('LINK INTIME INDIA LTD.', adapter);
      this.adapters.set('LINK INTIME INDIA LIMITED', adapter);
      this.adapters.set('LINK INTIME (INDIA) PVT LTD', adapter);
      this.adapters.set('LINK INTIME (INDIA) PVT. LTD.', adapter);
      this.adapters.set('LINK INTIME (INDIA) PRIVATE LIMITED', adapter);
      this.adapters.set('INTIME', adapter);
      this.adapters.set('IN.MPMS.MUFG.COM', adapter);
      this.adapters.set('LINKINTIME.CO.IN', adapter);
    }
    if (code === 'MAASHITLA' || code === 'MAASHITLA_SECURITIES') {
      this.adapters.set('MAASHITLA', adapter);
      this.adapters.set('MAASHITLA_SECURITIES', adapter);
      this.adapters.set('MAASHITLA SECURITIES', adapter);
      this.adapters.set('MAASHITLA SECURITIES LIMITED', adapter);
      this.adapters.set('MAASHITLA_SECURITIES_LIMITED', adapter);
      this.adapters.set('MAASHITLA SECURITIES PVT LTD', adapter);
      this.adapters.set('MAASHITLA_SECURITIES_PVT_LTD', adapter);
      this.adapters.set('MAASHITLA SECURITIES PRIVATE LIMITED', adapter);
      this.adapters.set('MAASHITLA_SECURITIES_PRIVATE_LIMITED', adapter);
    }
    if (code === 'SKYLINE' || code === 'SKYLINE_FINANCIAL_SERVICES') {
      this.adapters.set('SKYLINE', adapter);
      this.adapters.set('SKYLINE_FINANCIAL_SERVICES', adapter);
      this.adapters.set('SKYLINE FINANCIAL SERVICES', adapter);
      this.adapters.set('SKYLINE FINANCIAL SERVICES LIMITED', adapter);
      this.adapters.set('SKYLINE_FINANCIAL_SERVICES_LIMITED', adapter);
      this.adapters.set('SKYLINE FINANCIAL SERVICES PVT LTD', adapter);
      this.adapters.set('SKYLINE_FINANCIAL_SERVICES_PVT_LTD', adapter);
      this.adapters.set('SKYLINE FINANCIAL SERVICES PRIVATE LIMITED', adapter);
      this.adapters.set('SKYLINE_FINANCIAL_SERVICES_PRIVATE_LIMITED', adapter);
      this.adapters.set('SKYLINERTA', adapter);
      this.adapters.set('SKYLINE_RTA', adapter);
      this.adapters.set('SKYLINE RTA', adapter);
    }
    if (code === 'PURVA' || code === 'PURVA_SHAREGISTRY') {
      this.adapters.set('PURVA', adapter);
      this.adapters.set('PURVA_SHAREGISTRY', adapter);
      this.adapters.set('PURVA SHAREGISTRY', adapter);
      this.adapters.set('PURVA SHAREGISTRY (INDIA) PVT. LTD.', adapter);
      this.adapters.set('PURVA SHAREGISTRY (INDIA) PVT LTD', adapter);
      this.adapters.set('PURVA SHAREGISTRY INDIA PVT LTD', adapter);
      this.adapters.set('PURVA SHAREGISTRY INDIA PRIVATE LIMITED', adapter);
      this.adapters.set('PURVA_SHAREGISTRY_INDIA_PVT_LTD', adapter);
      this.adapters.set('PURVA_SHAREGISTRY_INDIA_PRIVATE_LIMITED', adapter);
      this.adapters.set('PURVA SHAREGISTRY PVT LTD', adapter);
      this.adapters.set('PURVA SHAREGISTRY PRIVATE LIMITED', adapter);
      this.adapters.set('PURVASHAREREGISTRY', adapter);
      this.adapters.set('PURVA_SHARE', adapter);
      this.adapters.set('PURVASHARE', adapter);
    }
    if (code === 'BIGSHARE' || code === 'BIGSHARE_SERVICES') {
      this.adapters.set('BIGSHARE', adapter);
      this.adapters.set('BIGSHARE_SERVICES', adapter);
      this.adapters.set('BIGSHARE SERVICES', adapter);
      this.adapters.set('BIGSHARE SERVICES PVT LTD', adapter);
      this.adapters.set('BIGSHARE_SERVICES_PVT_LTD', adapter);
      this.adapters.set('BIGSHARE SERVICES PRIVATE LIMITED', adapter);
      this.adapters.set('BIGSHARE_SERVICES_PRIVATE_LIMITED', adapter);
      this.adapters.set('BIG_SHARE', adapter);
      this.adapters.set('BIG SHARE', adapter);
      this.adapters.set('BIGSHAREONLINE', adapter);
    }

    this.logger.log(`Registered Registrar Adapter: ${adapter.name} (${code})`);
  }

  get(code?: string | null): IRegistrarAdapter | undefined {
    if (!code) return undefined;
    const normalized = normalizeRegistrarCode(code);
    return this.adapters.get(normalized) || this.adapters.get(code.trim().toUpperCase());
  }

  has(code?: string | null): boolean {
    if (!code) return false;
    const normalized = normalizeRegistrarCode(code);
    return this.adapters.has(normalized) || this.adapters.has(code.trim().toUpperCase());
  }

  getAll(): IRegistrarAdapter[] {
    const unique = new Set(this.adapters.values());
    return Array.from(unique);
  }
}
