import { Injectable, Logger } from '@nestjs/common';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
} from './registrar-identity-discovery.types';

@Injectable()
export class KfinIdentityDiscoveryAdapter implements IRegistrarIdentityDiscoveryAdapter {
  readonly registrarCode = 'KFINTECH';
  readonly name = 'KFin Technologies Discovery Adapter';

  private readonly logger = new Logger(KfinIdentityDiscoveryAdapter.name);

  /**
   * Fetches the current live KFin company registry directly from the official portal SPA bundle.
   */
  async discoverIssues(): Promise<DiscoveredRegistrarIssue[]> {
    const portalUrl =
      process.env.KFINTECH_PORTAL_URL || 'https://ipostatus.kfintech.com/';
    this.logger.log(`Fetching KFin status page from ${portalUrl}...`);

    try {
      const pageRes = await fetch(portalUrl);
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
      const jsRes = await fetch(jsUrl);
      if (!jsRes.ok) {
        throw new Error(`Failed to fetch KFin JS bundle: HTTP ${jsRes.status}`);
      }

      const jsText = await jsRes.text();
      return this.parseKfinRegistryBundle(jsText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error discovering KFin issues: ${msg}`);
      throw err;
    }
  }

  /**
   * Parses the raw JavaScript text of KFin's React bundle to extract the JSON company list.
   */
  public parseKfinRegistryBundle(jsText: string): DiscoveredRegistrarIssue[] {
    const startTag = "JSON.parse('";
    const endTag = "')";

    let pos = jsText.indexOf(startTag);
    if (pos === -1) {
      throw new Error(
        'Could not locate JSON.parse company registry in KFin JS bundle',
      );
    }

    // Advance past JSON.parse('
    pos += startTag.length;
    const endPos = jsText.indexOf(endTag, pos);
    if (endPos === -1) {
      throw new Error(
        'Could not locate end of JSON.parse string in KFin JS bundle',
      );
    }

    const jsonRawStr = jsText.substring(pos, endPos);
    let parsedList: Array<{ clientId: string; name: string }>;

    try {
      parsedList = JSON.parse(jsonRawStr);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to parse JSON string from KFin bundle: ${msg}`);
    }

    if (!Array.isArray(parsedList)) {
      throw new Error('Parsed KFin registry is not an array');
    }

    const now = new Date();
    return parsedList.map((item) => ({
      externalId: String(item.clientId).trim(),
      externalName: String(item.name).trim(),
      registrarCode: this.registrarCode,
      discoveredAt: now,
      rawPayload: item as unknown as Record<string, unknown>,
    }));
  }
}
