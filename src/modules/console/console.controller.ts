import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import { ConsoleService } from './console.service';
import { ConsoleIpoListQueryDto } from './console.types';
import { renderConsoleHtml } from './console.ui';
import { FAVICON_PNG_BASE64 } from './console.favicon';
import {
  CONSOLE_SESSION_COOKIE,
  ConsoleEnabledGuard,
  createSessionToken,
  getConsoleSessionSecret,
  parseCookies,
  timingSafeCompare,
  verifySessionToken,
} from './console.guard';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from '../../common/pagination/pagination';
import { AdminIpoService } from '../admin/admin-ipo.service';
import {
  AdminIpoQueryDto,
  ConfigureAllotmentDto,
  CreateAdminIpoDto,
  ImportAdminIpoJsonDto,
  UpdateAdminIpoDto,
} from '../admin/admin-ipo.dto';
import { IpoGuruService } from '../ipo-guru/ipo-guru.service';

@Controller('console')
@UseGuards(ConsoleEnabledGuard)
export class ConsoleController {
  private readonly logger = new Logger(ConsoleController.name);

  constructor(
    private readonly consoleService: ConsoleService,
    private readonly adminIpoService: AdminIpoService,
    private readonly ipoGuruService: IpoGuruService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  /**
   * Serves the self-contained, browser-accessible IPOVault Data Console HTML web UI.
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  getConsoleUi(@Res() res?: Response): string | void {
    const html = renderConsoleHtml('/api/v1/console/api');
    if (res && typeof res.setHeader === 'function' && typeof res.send === 'function') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(html);
      return html;
    }
    return html;
  }

  /**
   * Serves the IPOVault favicon.
   */
  @Get(['favicon.png', 'favicon.ico', 'api/favicon.png', 'api/favicon.ico'])
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400')
  getFavicon(@Res() res: Response) {
    const buffer = Buffer.from(FAVICON_PNG_BASE64, 'base64');
    if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Length', buffer.length.toString());
      res.end(buffer);
      return;
    }
    return buffer;
  }

  /**
   * Authenticate console admin credentials and issue signed httpOnly session cookie and token.
   */
  @Post('api/login')
  @Header('Content-Type', 'application/json')
  async login(
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const configuredUsername =
      this.configService.get('CONSOLE_ADMIN_USERNAME', { infer: true }) ||
      'admin';
    const adminApiKey = this.configService.get('ADMIN_API_KEY', { infer: true });
    const configuredPassword =
      this.configService.get('CONSOLE_ADMIN_PASSWORD', { infer: true }) ||
      adminApiKey ||
      'admin';

    const providedUsername =
      typeof body?.username === 'string' ? (body.username as string).trim() : '';
    const providedPassword =
      typeof body?.password === 'string' ? (body.password as string) : '';

    if (!providedUsername || !providedPassword) {
      throw new UnauthorizedException('Username and password required');
    }

    const isUserValid = timingSafeCompare(providedUsername, configuredUsername);
    const isPassValid =
      timingSafeCompare(providedPassword, configuredPassword) ||
      (adminApiKey ? timingSafeCompare(providedPassword, adminApiKey) : false);

    if (!isUserValid || !isPassValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const secret = getConsoleSessionSecret(this.configService);
    const token = createSessionToken(configuredUsername, secret);

    const isHttps =
      req.secure ||
      req.headers?.['x-forwarded-proto'] === 'https' ||
      req.headers?.['x-forwarded-ssl'] === 'on';

    res.cookie(CONSOLE_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      success: true,
      username: configuredUsername,
      token,
    };
  }

  /**
   * Log out from console session by clearing httpOnly session cookie.
   */
  @Post('api/logout')
  @Header('Content-Type', 'application/json')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isHttps =
      req.secure ||
      req.headers?.['x-forwarded-proto'] === 'https' ||
      req.headers?.['x-forwarded-ssl'] === 'on';

    res.clearCookie(CONSOLE_SESSION_COOKIE, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
    });
    return { success: true };
  }

  /**
   * Check active console session state.
   */
  @Get('api/session')
  async getSession(@Req() req: Request) {
    const authHeader = req.headers?.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const customHeaderToken = req.headers?.['x-console-token'] as string | undefined;
    const cookies = parseCookies(req.headers?.cookie);
    const token = bearerToken || customHeaderToken || cookies[CONSOLE_SESSION_COOKIE];

    const secret = getConsoleSessionSecret(this.configService);
    const verification = verifySessionToken(token, secret);
    if (!verification.valid) {
      throw new UnauthorizedException('Unauthenticated');
    }
    return { authenticated: true, username: verification.username };
  }

  /**
   * Read-only dashboard operational metrics for the console.
   */
  @Get('api/dashboard')
  async getDashboardSummary() {
    return this.consoleService.getDashboardSummary();
  }

  /**
   * Searchable canonical IPO list query for console explorer.
   */
  @Get('api/ipos')
  async listIpos(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('marketSegment') marketSegment?: string,
    @Query('exchange') exchange?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = parseInt(page || '', 10);
    const parsedLimit = parseInt(limit || '', 10);

    const safePage =
      isNaN(parsedPage) || parsedPage < 1 ? DEFAULT_PAGE : parsedPage;
    const safeLimit =
      isNaN(parsedLimit) || parsedLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(MAX_LIMIT, parsedLimit);

    const query: ConsoleIpoListQueryDto = {
      q,
      status,
      marketSegment,
      exchange,
      page: safePage,
      limit: safeLimit,
    };
    return this.consoleService.listIpos(query);
  }

  /**
   * Comprehensive canonical IPO detail for console inspector.
   */
  @Get('api/ipos/:id')
  async getIpoDetail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.consoleService.getIpoDetail(id);
  }

  /**
   * Field provenance & lineage for a canonical IPO.
   */
  @Get('api/ipos/:id/lineage')
  async getIpoLineage(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.consoleService.getIpoLineage(id);
  }

  /**
   * Read-only Data Quality Summary.
   */
  @Get('api/quality')
  async getDataQualitySummary() {
    return this.consoleService.getDataQualitySummary();
  }

  /**
   * Read-only Source Health Summary.
   */
  @Get('api/sources')
  async getSourceHealth() {
    return this.consoleService.getSourceHealth();
  }

  /**
   * Notification pipeline operational summary (Zero-Recipient Secrets).
   */
  @Get('api/notifications')
  async getNotificationOpsSummary() {
    return this.consoleService.getNotificationOpsSummary();
  }

  /**
   * Allotment check operations aggregate summary (Zero-PAN).
   */
  @Get('api/allotment')
  async getAllotmentOpsSummary() {
    return this.consoleService.getAllotmentOpsSummary();
  }

  // ==========================================
  // MANUAL IPOs CONSOLE MANAGEMENT ENDPOINTS
  // ==========================================

  @Get('api/manual-ipos')
  async listManualIpos(@Query() query: AdminIpoQueryDto) {
    return this.adminIpoService.listIpos(query);
  }

  @Post('api/manual-ipos')
  async createManualIpo(@Body() dto: CreateAdminIpoDto) {
    return this.adminIpoService.createIpo(dto);
  }

  @Get('api/manual-ipos/:id')
  async getManualIpoDetail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.getIpoDetail(id);
  }

  @Patch('api/manual-ipos/:id')
  async updateManualIpo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAdminIpoDto,
  ) {
    return this.adminIpoService.updateIpo(id, dto);
  }

  @Post('api/manual-ipos/:id/publish')
  async publishManualIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.publishIpo(id);
  }

  @Post('api/manual-ipos/:id/unpublish')
  async unpublishManualIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.unpublishIpo(id);
  }

  @Delete('api/manual-ipos/:id')
  async deleteManualIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.deleteIpo(id);
  }

  @Post('api/manual-ipos/:id/archive')
  async archiveManualIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.archiveIpo(id);
  }

  @Post('api/manual-ipos/:id/unarchive')
  async unarchiveManualIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.unarchiveIpo(id);
  }

  @Post('api/manual-ipos/import-json')
  async importManualIpoJson(
    @Body() dto: ImportAdminIpoJsonDto,
    @Query('targetIpoId') targetIpoId?: string,
  ) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Invalid JSON payload provided');
    }
    try {
      return await this.adminIpoService.importIpoFromJson(dto, targetIpoId);
    } catch (err: any) {
      this.logger.error({
        message: err.message || 'Manual IPO JSON import failed',
        stack: err.stack,
        response: err.response,
        statusCode: err.status || err.statusCode || 400,
      });

      if (err instanceof HttpException) {
        throw err;
      }

      throw new BadRequestException({
        message: 'Manual IPO JSON import failed',
        details: err.message || err,
      });
    }
  }

  @Post('api/manual-ipos/import-json/preview')
  async previewManualIpoJson(@Body() body: any) {
    return this.adminIpoService.previewAddOnlyJsonImport(body);
  }

  @Post('api/manual-ipos/import-json/commit')
  async commitManualIpoJson(@Body() body: any) {
    return this.adminIpoService.commitAddOnlyJsonImport(body);
  }

  @Post('api/manual-ipos/:id/allotment-config')
  async configureManualIpoAllotment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfigureAllotmentDto,
  ) {
    return this.adminIpoService.configureAllotment(id, dto);
  }

  // ==========================================
  // IPO GURU v1 INSPECTION & SYNC ENDPOINTS
  // ==========================================

  /**
   * Manual one-shot fetch from IPO Guru v1 API.
   *
   * READ-ONLY: does NOT insert/update/delete anything in the database.
   * Rate limited by IPO Guru: 10 requests/day, 1 request/minute.
   * API key is read from IPOGURU_API_KEY env var and never returned in this response.
   */
  @Post('api/ipo-guru/fetch')
  async fetchIpoGuruData() {
    try {
      return await this.ipoGuruService.fetchIpos();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`IPO Guru fetch error: ${msg}`);
      throw new BadRequestException({
        message: 'IPO Guru fetch failed',
        details: msg,
      });
    }
  }

  /**
   * Manual transactional synchronization of IPO Guru v1 data into canonical IPOVault database.
   * Rate limited by IPO Guru: 10 requests/day, 1 request/minute.
   */
  @Post('api/ipo-guru/sync')
  async syncIpoGuruData() {
    try {
      return await this.ipoGuruService.syncIpos();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`IPO Guru sync error: ${msg}`);
      throw new BadRequestException({
        message: 'IPO Guru sync failed',
        details: msg,
      });
    }
  }
}
