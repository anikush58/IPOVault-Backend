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
}
