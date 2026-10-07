import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import {
  AdminIpoQueryDto,
  BulkAdminIpoActionDto,
  BulkUpdateLifecycleStatusDto,
  ConfigureAllotmentDto,
  CreateAdminIpoDto,
  UpdateAdminIpoDto,
} from './admin-ipo.dto';
import { AdminIpoService } from './admin-ipo.service';

@Controller('admin/ipos')
@UseGuards(AdminGuard)
export class AdminIpoController {
  constructor(private readonly adminIpoService: AdminIpoService) {}

  /**
   * Bulk update Lifecycle Status for multiple IPOs.
   */
  @Post('bulk/status')
  async bulkUpdateStatus(@Body() dto: BulkUpdateLifecycleStatusDto) {
    return this.adminIpoService.bulkUpdateStatus(dto.ids, dto.status);
  }

  /**
   * Bulk publish multiple IPOs.
   */
  @Post('bulk/publish')
  async bulkPublish(@Body() dto: BulkAdminIpoActionDto) {
    return this.adminIpoService.bulkPublish(dto.ids);
  }

  /**
   * Bulk unpublish multiple IPOs.
   */
  @Post('bulk/unpublish')
  async bulkUnpublish(@Body() dto: BulkAdminIpoActionDto) {
    return this.adminIpoService.bulkUnpublish(dto.ids);
  }

  /**
   * Bulk archive multiple IPOs.
   */
  @Post('bulk/archive')
  async bulkArchive(@Body() dto: BulkAdminIpoActionDto) {
    return this.adminIpoService.bulkArchive(dto.ids);
  }

  /**
   * Bulk delete multiple IPOs.
   */
  @Post('bulk/delete')
  async bulkDelete(@Body() dto: BulkAdminIpoActionDto) {
    return this.adminIpoService.bulkDelete(dto.ids);
  }

  /**
   * Create a new draft IPO.
   */
  @Post()
  async createIpo(@Body() dto: CreateAdminIpoDto) {
    return this.adminIpoService.createIpo(dto);
  }

  /**
   * List all IPOs (DRAFT, PUBLISHED, ARCHIVED) for admin dashboard.
   */
  @Get()
  async listIpos(@Query() query: AdminIpoQueryDto) {
    return this.adminIpoService.listIpos(query);
  }

  /**
   * Get full admin detail view for an IPO.
   */
  @Get(':id')
  async getIpoDetail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.getIpoDetail(id);
  }

  /**
   * Update IPO / Company fields.
   */
  @Patch(':id')
  async updateIpo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAdminIpoDto,
  ) {
    return this.adminIpoService.updateIpo(id, dto);
  }

  /**
   * Delete an IPO permanently.
   */
  @Delete(':id')
  async deleteIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.deleteIpo(id);
  }

  /**
   * Validate and publish an IPO.
   */
  @Post(':id/publish')
  async publishIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.publishIpo(id);
  }

  /**
   * Revert publication status to DRAFT.
   */
  @Post(':id/unpublish')
  async unpublishIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.unpublishIpo(id);
  }

  /**
   * Archive an IPO.
   */
  @Post(':id/archive')
  async archiveIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.archiveIpo(id);
  }

  /**
   * Unarchive an IPO.
   */
  @Post(':id/unarchive')
  async unarchiveIpo(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminIpoService.unarchiveIpo(id);
  }

  /**
   * Configure registrar allotment checking mapping for an IPO.
   */
  @Post(':id/allotment-config')
  async configureAllotment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfigureAllotmentDto,
  ) {
    return this.adminIpoService.configureAllotment(id, dto);
  }

  /**
   * Manually triggers missing-field AI enrichment for an IPO using authoritative RHP/DRHP filings.
   */
  @Post(':id/enrich-ai')
  async enrichIpoWithAi(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body?: { forceRefresh?: boolean },
  ) {
    return this.adminIpoService.enrichIpoWithAi(id, body?.forceRefresh);
  }

  /**
   * Generate safe preview for additive-only JSON import.
   */
  @Post('import-json/preview')
  async previewJsonImport(@Body() body: any) {
    return this.adminIpoService.previewAddOnlyJsonImport(body);
  }

  /**
   * Commit additive-only JSON import.
   */
  @Post('import-json/commit')
  async commitJsonImport(@Body() body: any) {
    return this.adminIpoService.commitAddOnlyJsonImport(body);
  }
}
