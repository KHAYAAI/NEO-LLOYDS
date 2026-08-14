import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { SUBMISSION_STATUSES, type AuthContext, type SubmissionStatus } from '@neo-lloyds/domain';
import { SubmissionService } from './submission.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class CreateSubmissionDto {
  @IsString() riskId: string;
  @IsString() @MaxLength(300) title: string;
}

class AdvanceSubmissionDto {
  @IsIn(SUBMISSION_STATUSES as unknown as string[]) to: SubmissionStatus;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('risk-submission')
@Controller('submissions')
export class SubmissionController {
  constructor(@Inject(SubmissionService) private readonly submissions: SubmissionService) {}

  @Post()
  @RequireScopes('submission:write')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  @ApiOperation({ summary: 'Submit a risk package for analysis. Starts in DRAFT.' })
  async create(@Req() req: RequestWithAuth, @Body() body: CreateSubmissionDto) {
    return { submission: await this.submissions.create(auth(req), body) };
  }

  @Post(':id/advance')
  @RequireScopes('submission:write')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  @ApiOperation({
    summary:
      'Advance the submission state machine: DRAFT -> SUBMITTED -> ANALYSING -> SCORED -> READY_FOR_UNDERWRITING. Backward or skipped transitions are rejected.',
  })
  async advance(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: AdvanceSubmissionDto,
  ) {
    return { submission: await this.submissions.advance(auth(req), id, body.to) };
  }

  @Get(':id')
  @RequireScopes('submission:read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { submission: await this.submissions.get(auth(req), id) };
  }

  @Get()
  @RequireScopes('submission:read')
  async list(@Req() req: RequestWithAuth) {
    return { submissions: await this.submissions.list(auth(req)) };
  }
}
