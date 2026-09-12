import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
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

@Controller('console')
@UseGuards(ConsoleEnabledGuard)
export class ConsoleController {
  constructor(private readonly consoleService: ConsoleService) {}

  /**
   * Serves the self-contained, browser-accessible IPOVault Data Console HTML web UI.
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getConsoleUi(@Res() res?: Response): string {
    const html = renderConsoleHtml('/api/v1/console/api');
    if (
      res &&
      typeof res.setHeader === 'function' &&
      typeof res.send === 'function'
    ) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    }
    return html;
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
}
