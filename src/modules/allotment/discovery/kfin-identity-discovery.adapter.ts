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
   * Uses normal portal discovery as primary path, asset-manifest/origin fallback as secondary,
   * and static verified registry as final safety fallback.
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

    let jsUrl: string | null = null;

    // 1. Primary path: Fetch portal HTML and extract script bundle
    try {
      const pageRes = await fetch(portalUrl, { headers: browserHeaders });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const scriptMatch = html.match(/src=["']?(\.?\/static\/js\/[^"'\s>]+)/i);
        if (scriptMatch && scriptMatch[1]) {
          const cleanPath = scriptMatch[1].replace(/^\./, '');
          jsUrl = new URL(cleanPath, portalUrl).toString();
        }
      }
    } catch (err: unknown) {
      this.logger.debug(`Initial KFin portal HTML fetch failed: ${err}`);
    }

    // Try primary bundle fetch if jsUrl was found
    if (jsUrl) {
      try {
        this.logger.log(`Fetching live KFin SPA bundle from ${jsUrl}...`);
        const jsRes = await fetch(jsUrl, { headers: browserHeaders });
        if (jsRes.ok) {
          const jsText = await jsRes.text();
          if (!this.isHtmlPayload(jsText)) {
            const issues = this.parseKfinRegistryBundle(jsText);
            this.logger.log(
              `Successfully discovered ${issues.length} KFin company identities via primary bundle`,
            );
            return issues;
          }
          this.logger.warn(
            `Primary KFin bundle from ${jsUrl} returned HTML/CloudFront error; trying origin fallback...`,
          );
        }
      } catch (err: unknown) {
        this.logger.warn(`Primary KFin bundle fetch failed: ${err}`);
      }
    }

    // 2. Secondary path: KFin origin fallback via asset-manifest / cache-busted bundle
    try {
      let originBundleUrl: string | null = null;

      // Try discovering bundle path from asset-manifest.json
      try {
        const manifestUrl = new URL('/asset-manifest.json', portalUrl).toString();
        this.logger.log(`Checking KFin asset-manifest at ${manifestUrl}...`);
        const manifestRes = await fetch(manifestUrl, { headers: browserHeaders });
        if (manifestRes.ok) {
          const manifestJson = (await manifestRes.json()) as {
            files?: Record<string, string>;
          };
          const mainPath =
            manifestJson.files?.['main.js'] ||
            (manifestJson.files?.['entrypoints'] as unknown as string[])?.[1];
          if (mainPath && typeof mainPath === 'string') {
            const cleanPath = mainPath.replace(/^\./, '');
            originBundleUrl =
              new URL(cleanPath, portalUrl).toString() + `?cb=${Date.now()}`;
          }
        }
      } catch (manifestErr: unknown) {
        this.logger.debug(
          `Asset-manifest discovery failed (${manifestErr}); attempting direct origin query`,
        );
      }

      if (!originBundleUrl) {
        originBundleUrl = jsUrl
          ? `${jsUrl}?cb=${Date.now()}`
          : new URL('/static/js/main.30273529.js', portalUrl).toString() +
            `?cb=${Date.now()}`;
      }

      this.logger.log(
        `Attempting KFin origin bundle fetch from ${originBundleUrl}...`,
      );
      const originRes = await fetch(originBundleUrl, {
        headers: browserHeaders,
      });

      if (originRes.ok) {
        const originJs = await originRes.text();
        if (!this.isHtmlPayload(originJs)) {
          const issues = this.parseKfinRegistryBundle(originJs);
          this.logger.log(
            `Successfully recovered ${issues.length} KFin company identities from origin bundle`,
          );
          return issues;
        }
      }
      throw new Error('Origin bundle returned HTML or empty response');
    } catch (originErr: unknown) {
      const msg =
        originErr instanceof Error ? originErr.message : String(originErr);
      this.logger.warn(
        `Live KFin portal discovery failed (${msg}); falling back to static verified registry (${KFIN_VERIFIED_FALLBACK_REGISTRY.length} companies)`,
      );
      return this.getFallbackIssues();
    }
  }

  /**
   * Validates whether a response string is HTML (error/SPA fallback) rather than JS.
   */
  public isHtmlPayload(text: string): boolean {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    return (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<HTML') ||
      trimmed.includes('<head>') ||
      trimmed.includes('<body>')
    );
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
    if (this.isHtmlPayload(jsText)) {
      throw new Error('Received HTML payload instead of JavaScript bundle');
    }

    let parsedList: Array<{
      clientId?: string;
      client_id?: string;
      name?: string;
      company_name?: string;
    }> = [];

    const jsonRegex = /JSON\.parse\((['"`])(\[\s*\{[\s\S]*?\}\s*\])\1\)/;
    const match = jsonRegex.exec(jsText);

    if (match && match[2]) {
      const rawJsonStr = match[2];
      try {
        const unescaped = rawJsonStr
          .replace(/\\'/g, "'")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
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
          (item.clientId || item.client_id) &&
          (item.name || item.company_name),
      )
      .map((item) => ({
        externalId: String(item.clientId || item.client_id).trim(),
        externalName: String(item.name || item.company_name).trim(),
        registrarCode: this.registrarCode,
        discoveredAt: now,
        rawPayload: item as unknown as Record<string, unknown>,
      }));
  }
}
