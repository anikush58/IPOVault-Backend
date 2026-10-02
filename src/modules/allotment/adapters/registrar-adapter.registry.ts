import { Injectable, Logger } from '@nestjs/common';
import { IRegistrarAdapter } from '../allotment.types';

/**
 * Deterministically normalizes registrar names, display names, and codes to canonical adapter codes.
 */
export function normalizeRegistrarCode(rawCode?: string | null): string {
  if (!rawCode) return '';
  const trimmed = rawCode.trim().toUpperCase();

  // Explicit deterministic mapping for known KFin display names and aliases
  if (
    trimmed === 'KFINTECH' ||
    trimmed === 'KFIN' ||
    trimmed === 'KFIN_TECH' ||
    trimmed === 'KFIN TECHNOLOGIES' ||
    trimmed === 'KFIN_TECHNOLOGIES' ||
    trimmed === 'KFIN TECHNOLOGIES LIMITED' ||
    trimmed === 'KFIN_TECHNOLOGIES_LIMITED' ||
    trimmed === 'KFIN TECHNOLOGIES LTD' ||
    trimmed === 'KFIN TECHNOLOGIES LTD.' ||
    trimmed === 'KFIN_TECHNOLOGIES_LTD' ||
    trimmed === 'KFIN_TECHNOLOGIES_LTD.' ||
    trimmed === 'KFIN TECHNOLOGIES PVT LTD' ||
    trimmed === 'KFIN_TECHNOLOGIES_PVT_LTD' ||
    trimmed === 'KFIN TECHNOLOGIES PRIVATE LIMITED' ||
    trimmed === 'KFIN_TECHNOLOGIES_PRIVATE_LIMITED' ||
    trimmed === 'KARVY'
  ) {
    return 'KFINTECH';
  }

  // Explicit deterministic mapping for known MUFG / Link Intime display names and aliases
  if (
    trimmed === 'MUFG_INTIME' ||
    trimmed === 'MUFG' ||
    trimmed === 'MUFG INTIME' ||
    trimmed === 'MUFG INTIME INDIA' ||
    trimmed === 'MUFG INTIME INDIA (FORMERLY LINK INTIME)' ||
    trimmed === 'MUFG INTIME INDIA PRIVATE LIMITED' ||
    trimmed === 'LINKINTIME' ||
    trimmed === 'LINK_INTIME' ||
    trimmed === 'LINK INTIME' ||
    trimmed === 'LINK INTIME INDIA PVT LTD' ||
    trimmed === 'LINK INTIME INDIA PRIVATE LIMITED' ||
    trimmed === 'INTIME'
  ) {
    return 'MUFG_INTIME';
  }

  // Explicit deterministic mapping for known Maashitla display names and aliases
  if (
    trimmed === 'MAASHITLA' ||
    trimmed === 'MAASHITLA_SECURITIES' ||
    trimmed === 'MAASHITLA SECURITIES' ||
    trimmed === 'MAASHITLA SECURITIES LIMITED' ||
    trimmed === 'MAASHITLA_SECURITIES_LIMITED' ||
    trimmed === 'MAASHITLA SECURITIES PVT LTD' ||
    trimmed === 'MAASHITLA_SECURITIES_PVT_LTD' ||
    trimmed === 'MAASHITLA SECURITIES PRIVATE LIMITED' ||
    trimmed === 'MAASHITLA_SECURITIES_PRIVATE_LIMITED'
  ) {
    return 'MAASHITLA';
  }

  // Explicit deterministic mapping for known Skyline display names and aliases
  if (
    trimmed === 'SKYLINE' ||
    trimmed === 'SKYLINE_FINANCIAL_SERVICES' ||
    trimmed === 'SKYLINE FINANCIAL SERVICES' ||
    trimmed === 'SKYLINE FINANCIAL SERVICES LIMITED' ||
    trimmed === 'SKYLINE_FINANCIAL_SERVICES_LIMITED' ||
    trimmed === 'SKYLINE FINANCIAL SERVICES PVT LTD' ||
    trimmed === 'SKYLINE_FINANCIAL_SERVICES_PVT_LTD' ||
    trimmed === 'SKYLINE FINANCIAL SERVICES PRIVATE LIMITED' ||
    trimmed === 'SKYLINE_FINANCIAL_SERVICES_PRIVATE_LIMITED' ||
    trimmed === 'SKYLINERTA' ||
    trimmed === 'SKYLINE_RTA' ||
    trimmed === 'SKYLINE RTA'
  ) {
    return 'SKYLINE';
  }

  // Explicit deterministic mapping for known Purva Sharegistry display names and aliases
  if (
    trimmed === 'PURVA' ||
    trimmed === 'PURVA_SHAREGISTRY' ||
    trimmed === 'PURVA SHAREGISTRY' ||
    trimmed === 'PURVA SHAREGISTRY (INDIA) PVT. LTD.' ||
    trimmed === 'PURVA SHAREGISTRY (INDIA) PVT LTD' ||
    trimmed === 'PURVA SHAREGISTRY INDIA PVT LTD' ||
    trimmed === 'PURVA SHAREGISTRY INDIA PRIVATE LIMITED' ||
    trimmed === 'PURVA_SHAREGISTRY_INDIA_PVT_LTD' ||
    trimmed === 'PURVA_SHAREGISTRY_INDIA_PRIVATE_LIMITED' ||
    trimmed === 'PURVA SHAREGISTRY PVT LTD' ||
    trimmed === 'PURVA SHAREGISTRY PRIVATE LIMITED' ||
    trimmed === 'PURVASHAREREGISTRY' ||
    trimmed === 'PURVA_SHARE' ||
    trimmed === 'PURVASHARE'
  ) {
    return 'PURVA';
  }

  // Explicit deterministic mapping for known Bigshare display names and aliases
  if (
    trimmed === 'BIGSHARE' ||
    trimmed === 'BIG_SHARE' ||
    trimmed === 'BIG SHARE' ||
    trimmed === 'BIGSHARE_SERVICES' ||
    trimmed === 'BIGSHARE SERVICES' ||
    trimmed === 'BIGSHARE SERVICES PVT LTD' ||
    trimmed === 'BIGSHARE_SERVICES_PVT_LTD' ||
    trimmed === 'BIGSHARE SERVICES PRIVATE LIMITED' ||
    trimmed === 'BIGSHARE_SERVICES_PRIVATE_LIMITED' ||
    trimmed === 'BIGSHAREONLINE' ||
    trimmed === 'BIGSHARE ONLINE'
  ) {
    return 'BIGSHARE';
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
      this.adapters.set('LINK INTIME INDIA PRIVATE LIMITED', adapter);
      this.adapters.set('INTIME', adapter);
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
