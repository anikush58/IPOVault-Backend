import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { AllotmentService } from './allotment.service';
import { AllotmentJobService } from './allotment-job.service';
import {
  AllotmentCheckResponseDto,
  CheckAllotmentBodyDto,
  checkAllotmentBodySchema,
  CreateAllotmentJobBodyDto,
  createAllotmentJobBodySchema,
} from './dto/allotment.dto';

@Controller('allotment')
export class AllotmentController {
  constructor(
    private readonly allotmentService: AllotmentService,
    private readonly allotmentJobService: AllotmentJobService,
  ) {}

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
    };
  }

  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
  async createJob(
    @Body() body: CreateAllotmentJobBodyDto,
    @Headers('x-user-id') userId?: string,
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

  @Get('jobs/:id')
  async getJob(@Param('id') id: string, @Headers('x-user-id') userId?: string) {
    return this.allotmentJobService.getJob(id, userId);
  }

  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retryJob(
    @Param('id') id: string,
    @Body() body?: { identifierValuesMap?: Record<string, string> },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.allotmentJobService.retryFailedItems(
      id,
      userId,
      body?.identifierValuesMap,
    );
  }

  @Get('sources')
  getSources() {
    return {
      registrars: this.allotmentService.getSupportedRegistrars(),
    };
  }
}
