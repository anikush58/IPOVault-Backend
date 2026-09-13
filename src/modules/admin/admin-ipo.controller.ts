import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentType } from '@prisma/client';
import { AdminGuard } from './admin.guard';
import {
  AdminIpoQueryDto,
  ConfigureAllotmentDto,
  CreateAdminIpoDto,
  ParseDocumentUrlDto,
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
   * Upload a DRHP/RHP PDF document and extract fields.
   */
  @Post('documents/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string },
    @Query('ipoId') ipoId?: string,
    @Query('documentType') documentType?: DocumentType,
  ) {
    if (!file) {
      throw new Error('No PDF file provided in request body');
    }
    return this.adminIpoService.parseAndStorePdfBuffer(
      file.buffer,
      file.originalname || 'document.pdf',
      file.mimetype || 'application/pdf',
      ipoId,
      documentType || DocumentType.RHP,
    );
  }

  /**
   * Parse a PDF document from a web URL (or SEBI HTML detail page).
   */
  @Post('documents/parse-url')
  async parseDocumentUrl(@Body() dto: ParseDocumentUrlDto) {
    return this.adminIpoService.parseUrlAndStore(
      dto.url,
      dto.ipoId,
      dto.documentType || DocumentType.RHP,
    );
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
