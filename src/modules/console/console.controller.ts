import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConsoleService } from './console.service';
import { ConsoleIpoListQueryDto } from './console.types';
import { renderConsoleHtml } from './console.ui';
import { ConsoleEnabledGuard } from './console.guard';
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

@Controller('console')
@UseGuards(ConsoleEnabledGuard)
export class ConsoleController {
  constructor(
    private readonly consoleService: ConsoleService,
    private readonly adminIpoService: AdminIpoService,
  ) {}

  /**
   * Serves the self-contained, browser-accessible IPOVault Data Console HTML web UI.
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  getConsoleUi(@Res() res: Response): void {
    const html = renderConsoleHtml('/api/v1/console/api');
    if (res && typeof res.setHeader === 'function' && typeof res.send === 'function') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(html);
    }
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
    return this.adminIpoService.importIpoFromJson(dto, targetIpoId);
  }

  @Post('api/manual-ipos/:id/allotment-config')
  async configureManualIpoAllotment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfigureAllotmentDto,
  ) {
    return this.adminIpoService.configureAllotment(id, dto);
  }
}
