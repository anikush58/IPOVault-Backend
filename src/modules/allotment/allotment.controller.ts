import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AllotmentService } from './allotment.service';
import { AllotmentJobService } from './allotment-job.service';
import { AllotmentIntelligenceService } from './allotment-intelligence.service';
import {
  AllotmentCheckResponseDto,
  CheckAllotmentBodyDto,
  checkAllotmentBodySchema,
  CreateAllotmentJobBodyDto,
  createAllotmentJobBodySchema,
} from './dto/allotment.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('allotment')
@UseGuards(FirebaseAuthGuard)
export class AllotmentController {
  constructor(
    private readonly allotmentService: AllotmentService,
    private readonly allotmentJobService: AllotmentJobService,
    private readonly allotmentIntelligenceService: AllotmentIntelligenceService,
  ) {}

  @Get('intelligence/summary')
  async getUserSummaryIntelligence(@CurrentUser('uid') userId: string) {
    return this.allotmentIntelligenceService.getUserSummaryIntelligence(userId);
  }

  @Get('intelligence/history')
  async getUserAllotmentHistory(@CurrentUser('uid') userId: string) {
    return this.allotmentIntelligenceService.getUserAllotmentHistory(userId);
  }

  @Get('intelligence/pans')
  async getUserPanIntelligence(@CurrentUser('uid') userId: string) {
    return this.allotmentIntelligenceService.getUserPanIntelligence(userId);
  }

  @Get('jobs/:id/intelligence')
  async getJobIntelligence(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.allotmentIntelligenceService.getJobIntelligence(id, userId);
  }

  @Get('ipos/:id/intelligence')
  async getIpoAllotmentIntelligence(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.allotmentIntelligenceService.getIpoAllotmentIntelligence(
      id,
      userId,
    );
  }

  /**
   * Public Single-Check: Performs direct live lookup on official registrar without authentication.
   * Does not store or persist PAN in database.
   */
  @Public()
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async checkAllotment(
    @Body() body: CheckAllotmentBodyDto,
  ): Promise<AllotmentCheckResponseDto> {
    const validated = checkAllotmentBodySchema.parse(body);

    const result = await this.allotmentService.checkAllotment({
      ipoId: validated.ipoId,
      identifierType: validated.identifierType,
      identifierValue: validated.identifierValue,
      captchaToken: validated.captchaToken,
      sessionId: validated.sessionId,
    });

    return {
      status: result.status,
      sharesApplied: result.sharesApplied,
      sharesAllotted: result.sharesAllotted,
      allotmentPrice: result.allotmentPrice,
      amountApplied: result.amountApplied,
      amountRefunded: result.amountRefunded,
      applicantName: result.applicantName,
      sourceCode: result.sourceCode,
      sourceTimestamp: result.sourceTimestamp?.toISOString(),
      checkedAt: result.checkedAt.toISOString(),
      errorMessage: result.errorMessage,
      captchaChallenge: result.captchaChallenge,
      categoryResults: result.categoryResults,
    };
  }

  /**
   * Protected Job Creation: Enqueues bulk verification across user's saved PANs or explicit list.
   * Requires verified Firebase ID token and binds job to verified UID.
   */
  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
  async createJob(
    @Body() body: CreateAllotmentJobBodyDto,
    @CurrentUser('uid') userId: string,
  ) {
    const validated = createAllotmentJobBodySchema.parse(body);
    const job = await this.allotmentJobService.createJob(
      {
        ipoId: validated.ipoId,
        identifierType: validated.identifierType,
        identifierValues: validated.identifierValues,
      },
      userId,
    );

    return this.allotmentJobService.getJob(job.id, userId);
  }

  /**
   * Protected Job Retrieval: Retrieves progress and results of a bulk allotment check job.
   * Enforces strict user ownership verification against verified token UID.
   */
  @Get('jobs/:id')
  async getJob(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.allotmentJobService.getJob(id, userId);
  }

  /**
   * Protected Job Retry: Retries failed checks in a job owned by verified token UID.
   */
  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retryJob(
    @Param('id') id: string,
    @Body() body?: { identifierValuesMap?: Record<string, string> },
    @CurrentUser('uid') userId?: string,
  ) {
    return this.allotmentJobService.retryFailedItems(
      id,
      userId!,
      body?.identifierValuesMap,
    );
  }

  /**
   * Public Supported Registrars Directory: Lists supported allotment source adapters.
   */
  @Public()
  @Get('sources')
  getSources() {
    return {
      registrars: this.allotmentService.getSupportedRegistrars(),
    };
  }
}
