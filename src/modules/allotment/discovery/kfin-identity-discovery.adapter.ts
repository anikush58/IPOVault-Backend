import { Injectable, Logger } from '@nestjs/common';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
} from './registrar-identity-discovery.types';

export const KFIN_VERIFIED_FALLBACK_REGISTRY: Array<{
  clientId: string;
  name: string;
}> = [
  { clientId: '47651989560', name: 'SOLLFEGE SMART ELECTRONICS LIMITED' },
  { clientId: '37168935020', name: 'SRIT INDIA LIMITED' },
  { clientId: '93220762680', name: 'ORIENT CABLES (INDIA) LIMITED-IPO' },
  { clientId: '27219762590', name: 'BENCH MARK INFOTECH SERVICES LIMITED' },
  { clientId: '30273060190', name: 'ELEVATE CAMPUSES LIMITED' },
  { clientId: '79990817560', name: 'VARMORA GRANITO LIMITED' },
  { clientId: '15174680810', name: 'HIMALAYA NUTRAVEDICS INDIA LIMITED' },
  { clientId: '93157481460', name: 'AXIOM GAS ENGINEERING LIMITED' },
  { clientId: '82437854510', name: 'SONASELECTION INDIA LIMITED' },
  { clientId: '46596758590', name: 'KHERIA AUTOCOMP LIMITED' },
  { clientId: '49590168400', name: 'HERO MOTORS LIMITED' },
  { clientId: '50005836440', name: 'SS RETAIL LIMITED' },
  { clientId: '18432822190', name: 'CENTURY BUSINESS MEDIA LIMITED' },
  { clientId: '66907812020', name: 'RENTOMOJO LIMITED' },
  { clientId: '58236771090', name: 'LCC PROJECTS LIMITED' },
  { clientId: '76081590190', name: 'STEAMHOUSE INDIA LIMITED' },
  { clientId: '57236082750', name: 'VINOD TEXWORLD LIMITED' },
  { clientId: '46407184950', name: 'KOSAMATTAM FINANCE LTD NCD38 AUGUST 2026' },
  { clientId: '75003530500', name: 'PRASOL CHEMICALS LIMITED' },
  { clientId: '95527153360', name: 'KLM AXIVA FINVEST LIMITED NCD14 AUGUST 2026' },
  { clientId: '58129803280', name: 'PRANAV CONSTRUCTIONS LIMITED' },
  { clientId: '33631182620', name: 'APANA LOGISTICS LIMITED' },
  { clientId: '40580036070', name: 'FLY HI MARITIME TRAVELS LIMITED' },
  { clientId: '60121009540', name: 'RAYS OF BELIEF LIMITED' },
  { clientId: '34024394990', name: 'ASHUTOSH FIBRE LIMITED SME' },
  { clientId: '64793825640', name: 'ASHUTOSH FIBRE LIMITED' },
  { clientId: '85357713080', name: 'SHANTI INORGANICS LIMITED' },
  { clientId: '95989183810', name: 'PURPLE STYLE LABS LIMITED' },
  { clientId: '63488567220', name: 'ANNU PROJECTS LIMITED' },
  { clientId: '29984512460', name: 'SUMAX ENGINEERING LIMITED' },
  { clientId: '61328680581', name: 'TEMPSENS INSTRUMENTS (INDIA) LIMITED' },
  { clientId: '54923077460', name: 'SHANKESH JEWELLERS LIMITED' },
  { clientId: '52457887480', name: 'HORIZON INDUSTRIAL PARKS LIMITED' },
  { clientId: '58583640510', name: 'CHEMMANUR CREDITS AND INVESTMENTS LIMITED AUGUST2026' },
  { clientId: '12562536840', name: 'CREDENT CONNECT N CARE LIMITED' },
  { clientId: '86153103110', name: 'SHIPROCKET LIMITED' },
  { clientId: '29849673370', name: 'MILKY MIST DAIRY FOOD LIMITED' },
  { clientId: '81387868980', name: 'MOLBIO DIAGNOSTICS LIMITED' },
  { clientId: '94818267561', name: 'DHOOT TRANSMISSION LIMITED' },
  { clientId: '62198153830', name: 'ARDEE INDUSTRIES LIMITED' },
  { clientId: '44065980180', name: 'MV ELECTROSYSTEMS LIMITED' },
  { clientId: '53707331280', name: 'JUNIPER GREEN ENERGY LIMITED' },
  { clientId: '67709372110', name: 'DHAVAL PACKAGING LIMITED' },
  { clientId: '43836057990', name: 'MANIPAL HEALTH ENTERPRISES LIMITED' },
  { clientId: '42817695520', name: 'ADVANCE TECHNOFORG LIMITED' },
  { clientId: '55385908200', name: 'CUBE HIGHWAYS TRUST - INVIT' },
  { clientId: '94419360500', name: 'XTRANET TECHNOLOGIES LIMITED' },
  { clientId: '63734978420', name: 'SHREE BALAJI MALA TEXTILES LIMITED' },
  { clientId: '19193086920', name: 'GULF LLOYDS INDIA LIMITED' },
  { clientId: '89605487720', name: 'CALIBER MINING AND LOGISTICS LIMITED IPO' },
  { clientId: '89468061991', name: 'SBI FUNDS MANAGMENT LIMITED IPO' },
  { clientId: '41422222050', name: 'ALPINE TEXWORLD LIMITED IPO' },
  { clientId: '73206134640', name: 'KRATIKAL TECH LIMITED SME' },
  { clientId: '17643901490', name: 'TEJA ENGINEERING INDUSTRIES LIMITED SME IPO' },
  { clientId: '65065971040', name: 'ADON AGRO COMMODITIES LIMITED SME IPO' },
  { clientId: '39751101520', name: 'CRAZY SNACKS LIMITED SME IPO' },
  { clientId: '89075375160', name: 'CSM TECHNOLOGIES LIMITED IPO' },
  { clientId: '10609640970', name: 'TURTLEMINT FINTECH SOLUTIONS LIMITED IPO' },
  { clientId: '82984397570', name: 'CLAY CRAFT INDIA LIMITED SME IPO' },
  { clientId: '41208427340', name: 'LIOTECH INDUSTRIES LIMITED SME IPO' },
  { clientId: '22809299660', name: 'PRACHAY CAPITAL LIMITED NCDS JUNE 2026' },
  { clientId: '34105687640', name: 'HORIZON RECLAIM INDIA LIMITED' },
  { clientId: '89347697100', name: 'EDELWEISS FINANCIAL SERVICES LTD NCD18 JUNE 2026' },
  { clientId: '68599915170', name: 'MUTHOOT MERCANTILE LIMITED - JUNE 2026' },
  { clientId: '70806992450', name: 'HEXAGON NUTRITION LIMITED' },
  { clientId: '28962929970', name: 'VAHH CHEMICALS LIMITED' },
  { clientId: '65310715440', name: 'CMR GREEN TECHNOLOGIES LIMITED' },
  { clientId: '90318758440', name: 'KOSAMATTAM FINANCE LIMITED - NCDS - MAY-2026' },
  { clientId: '53483362510', name: 'TEAMTECH FORMWORK SOLUTIONS LIMITED' },
  { clientId: '26859517830', name: 'RFBL FLEXI PACK LIMITED' },
  { clientId: '28267215520', name: 'BAGMANE PRIME OFFICE REIT' },
  { clientId: '34561715130', name: 'VALUE 360 COMMUNICATIONS LIMITED' },
  { clientId: '54450217260', name: 'ONEMI TECHNOLOGY SOLUTIONS LIMITED' },
  { clientId: '92634312570', name: 'ADISOFT TECHNOLOGIES LIMITED' },
  { clientId: '73146088770', name: 'CITIUS TRANSNET INVESTMENT TRUST' },
  { clientId: '80184898770', name: 'MEHUL TELECOM LIMITED' },
  { clientId: '51817446680', name: 'PROPSHARE CELESTIA SM REIT 2026' },
  { clientId: '77980267280', name: 'AMIR CHAND JAGDISH KUMAR (EXPORTS) LIMITED' },
  { clientId: '67638044790', name: 'CENTRAL MINE PLANNING AND DESIGN INSTITUTE LIMITED' },
  { clientId: '26440316230', name: 'NOVUS LOYALTY LIMITED' },
  { clientId: '91318037690', name: 'EDELWEISS FINANCIAL SERVICES LTD-NCDS-MARCH-2026' },
  { clientId: '35015605280', name: 'INNOVISION LIMITED-IPO' },
  { clientId: '94209528790', name: 'RAAJMARG INFRA INVESTMENT TRUST - INVIT' },
  { clientId: '76300775270', name: 'CHEMMANUR CREDITS AND INVESTMENTS LIMITED - NCDS8 - MARCH2026' },
  { clientId: '43990634450', name: 'RAJPUTANA STAINLESS LIMITED-IPO' },
  { clientId: '62507743750', name: 'PRACHAY CAPITAL LIMITED-NCDS3-FEBRUARY-2026' },
  { clientId: '51058840660', name: 'ACCORD TRANSFORMER AND SWITCHGEAR LIMITED' },
  { clientId: '85658340220', name: 'FRACTAL INDUSTRIES LIMITED' },
  { clientId: '20422755930', name: 'KOSAMATTAM FINANCE LIMITED - NCD36 - FEBRUARY 2026' },
  { clientId: '64562521850', name: 'POWER FINANCE CORPORATION LIMITED - ZERO COUPON NCDS' },
  { clientId: '33209180890', name: 'POWER FINANCE CORPORATION LIMITED - NCDS' },
  { clientId: '62430336220', name: 'AYE FINANCE LIMITED' },
  { clientId: '18899853180', name: 'ACCRETION NUTRAVEDA LIMITED' },
  { clientId: '41087928370', name: 'KANISHK ALUMINIUM INDIA LIMITED' },
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
