import { Injectable, Logger } from '@nestjs/common';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
} from './registrar-identity-discovery.types';

export function parseMufgRegistryHtml(
  htmlText: string,
  registrarCode = 'MUFG_INTIME',
): DiscoveredRegistrarIssue[] {
  const optionRegex = /<option\s+[^>]*value=["']([^"']+)["'][^>]*>([^<]+)<\/option>/gi;
  const issues: DiscoveredRegistrarIssue[] = [];
  const now = new Date();

  let match: RegExpExecArray | null;
  while ((match = optionRegex.exec(htmlText)) !== null) {
    const value = (match[1] || '').trim();
    const text = (match[2] || '').trim();

    if (
      value &&
      value !== '0' &&
      value !== '-1' &&
      !text.toLowerCase().includes('select company') &&
      !text.toLowerCase().includes('--select--')
    ) {
      issues.push({
        externalId: value,
        externalName: text,
        registrarCode,
        discoveredAt: now,
        rawPayload: { value, text },
      });
    }
  }

  return issues;
}

@Injectable()
export class MufgIdentityDiscoveryAdapter
  implements IRegistrarIdentityDiscoveryAdapter
{
  readonly registrarCode = 'MUFG_INTIME';
  readonly name = 'MUFG Intime Identity Discovery Adapter';

  private readonly logger = new Logger(MufgIdentityDiscoveryAdapter.name);

  async discoverIssues(): Promise<DiscoveredRegistrarIssue[]> {
    const portalUrl =
      process.env.MUFG_INTIME_PORTAL_URL || 'https://ipostatus.linkintime.co.in/';
    this.logger.log(`Fetching MUFG Intime company list from ${portalUrl}...`);

    try {
      const pageRes = await fetch(portalUrl);
      if (!pageRes.ok) {
        throw new Error(
          `Failed to fetch MUFG portal page: HTTP ${pageRes.status}`,
        );
      }

      const htmlText = await pageRes.text();
      return parseMufgRegistryHtml(htmlText, this.registrarCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error discovering MUFG Intime issues: ${msg}`);
      throw err;
    }
  }
}
