import { Injectable, Logger } from '@nestjs/common';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
} from './registrar-identity-discovery.types';

const KFIN_VERIFIED_FALLBACK_REGISTRY: Array<{
  clientId: string;
  name: string;
}> = [
  { clientId: '37168935020', name: 'SRIT INDIA LIMITED' },
  { clientId: '94818267561', name: 'DHOOT TRANSMISSION LIMITED' },
  { clientId: '66907812020', name: 'RENTOMOJO LIMITED' },
  { clientId: '75003530500', name: 'PRASOL CHEMICALS LIMITED' },
  { clientId: '35015605280', name: 'INNOVISION LIMITED-IPO' },
  { clientId: '89468061991', name: 'SBI FUNDS MANAGMENT LIMITED IPO' },
  { clientId: '64793825640', name: 'ASHUTOSH FIBRE LIMITED' },
  { clientId: '81387868980', name: 'MOLBIO DIAGNOSTICS LIMITED' },
  { clientId: '54450217260', name: 'ONEMI TECHNOLOGY SOLUTIONS LIMITED' },
];

@Injectable()
export class KfinIdentityDiscoveryAdapter implements IRegistrarIdentityDiscoveryAdapter {
  readonly registrarCode = 'KFINTECH';
  readonly name = 'KFin Technologies Discovery Adapter';

  private readonly logger = new Logger(KfinIdentityDiscoveryAdapter.name);

  /**
   * Fetches the current live KFin company registry directly from the official portal SPA bundle.
   * Falls back to verified static registry when live portal/bundle discovery fails.
   */
  async discoverIssues(): Promise<DiscoveredRegistrarIssue[]> {
    const portalUrl =
      process.env.KFINTECH_PORTAL_URL || 'https://ipostatus.kfintech.com/';
    this.logger.log(`Fetching KFin status page from ${portalUrl}...`);

    const browserHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      Origin: 'https://ipostatus.kfintech.com',
      Referer: 'https://ipostatus.kfintech.com/',
    };

    try {
      const pageRes = await fetch(portalUrl, { headers: browserHeaders });
      if (!pageRes.ok) {
        throw new Error(
          `Failed to fetch KFin portal page: HTTP ${pageRes.status}`,
        );
      }

      const html = await pageRes.text();
      const scriptMatch = html.match(/src=["']?(\.?\/static\/js\/[^"'\s>]+)/i);
      if (!scriptMatch || !scriptMatch[1]) {
        throw new Error(
          'Could not dynamically discover main JS bundle path from KFin portal HTML',
        );
      }

      const cleanPath = scriptMatch[1].replace(/^\./, '');
      const jsUrl = new URL(cleanPath, portalUrl).toString();

      this.logger.log(`Fetching live KFin SPA bundle from ${jsUrl}...`);
      const jsRes = await fetch(jsUrl, { headers: browserHeaders });
      if (!jsRes.ok) {
        throw new Error(`Failed to fetch KFin JS bundle: HTTP ${jsRes.status}`);
      }

      const jsText = await jsRes.text();
      return this.parseKfinRegistryBundle(jsText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Live KFin portal discovery failed (${msg}); falling back to static verified registry (${KFIN_VERIFIED_FALLBACK_REGISTRY.length} companies)`,
      );
      return this.getFallbackIssues();
    }
  }

  /**
   * Returns verified real KFin mappings as fallback discovery records.
   */
  public getFallbackIssues(): DiscoveredRegistrarIssue[] {
    const now = new Date();
    return KFIN_VERIFIED_FALLBACK_REGISTRY.map((item) => ({
      externalId: item.clientId,
      externalName: item.name,
      registrarCode: this.registrarCode,
      discoveredAt: now,
      rawPayload: item as unknown as Record<string, unknown>,
    }));
  }

  /**
   * Parses the raw JavaScript text of KFin's React bundle to extract the JSON company list.
   */
  public parseKfinRegistryBundle(jsText: string): DiscoveredRegistrarIssue[] {
    const jsonRegex = /JSON\.parse\('(\[\s*\{[\s\S]*?\}\s*\])'\)/;
    const match = jsonRegex.exec(jsText);

    let parsedList: Array<{ clientId: string; name: string }> = [];

    if (match) {
      const rawJsonStr = match[1];
      try {
        const unescaped = rawJsonStr.replace(/\\'/g, "'").replace(/\\"/g, '"');
        parsedList = JSON.parse(unescaped);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse JSON string from KFin bundle: ${msg}`);
      }
    } else {
      // Fallback: try direct array matching in bundle
      const directArrayRegex =
        /\[\s*\{"clientId"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"[^"]+"\}[\s\S]*?\]/;
      const directMatch = directArrayRegex.exec(jsText);
      if (directMatch) {
        try {
          parsedList = JSON.parse(directMatch[0]);
        } catch {
          // Ignore fallback error and throw main parse error below
        }
      }
    }

    if (!parsedList || !Array.isArray(parsedList) || parsedList.length === 0) {
      throw new Error(
        'Could not locate JSON.parse company registry in KFin JS bundle',
      );
    }

    const now = new Date();
    return parsedList
      .filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          (item.clientId || (item as any).client_id) &&
          (item.name || (item as any).company_name),
      )
      .map((item) => ({
        externalId: String(item.clientId || (item as any).client_id).trim(),
        externalName: String(item.name || (item as any).company_name).trim(),
        registrarCode: this.registrarCode,
        discoveredAt: now,
        rawPayload: item as unknown as Record<string, unknown>,
      }));
  }
}
