import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, Length, MaxLength } from 'class-validator';
import type { AuthContext } from '@neo-lloyds/domain';
import { AgentService } from './agent.service.js';
import { RequireScopes, type RequestWithAuth } from '../common/auth.js';

class SubmitActivityDto {
  @IsString() riskId: string;
  @IsString() @MaxLength(200) title: string;
}

class ExecuteDto {
  @IsInt() @IsPositive() indicativeAmountMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

/**
 * The AI Agent API (roadmap Phase 11). Every route here also works for a
 * human caller — the mandate check is a no-op for `subjectKind !== 'AGENT'`
 * (security-model.md §4) — but this is the flow an autonomous agent is
 * expected to drive end to end: authenticate → submit activity → request
 * assessment → indicative protection → coverage options → (human approval,
 * enforced upstream by Phase 3's clearance gate) → permitted execution →
 * settlement information.
 */
@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Post('activity')
  @RequireScopes('agent:activity:submit')
  @ApiOperation({ summary: 'Step 1: submit activity — a risk submission, mandate-checked before it happens.' })
  async submitActivity(@Req() req: RequestWithAuth, @Body() body: SubmitActivityDto) {
    return { submission: await this.agent.submitActivity(auth(req), body) };
  }

  @Get('risks/:id/assessment')
  @RequireScopes('agent:assessment:read')
  @ApiOperation({ summary: 'Step 2: request assessment — the advisory AI analyst report. Never a decision.' })
  async requestAssessment(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { assessment: await this.agent.requestAssessment(auth(req), id) };
  }

  @Get('risks/:id/indicative-protection')
  @RequireScopes('agent:protection:read')
  @ApiOperation({
    summary:
      'Step 3: indicative protection — the underwriting assessment already on record, and whether it is ' +
      'currently clear to proceed. Never binding; creates nothing.',
  })
  async indicativeProtection(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return await this.agent.indicativeProtection(auth(req), id);
  }

  @Get('coverage-options')
  @RequireScopes('agent:coverage:read')
  @ApiOperation({ summary: 'Step 4: coverage options — open marketplace listings, read-only.' })
  async coverageOptions(
    @Req() req: RequestWithAuth,
    @Query('riskClass') riskClass?: string,
    @Query('jurisdiction') jurisdiction?: string,
  ) {
    return {
      listings: await this.agent.coverageOptions(auth(req), {
        ...(riskClass ? { riskClass } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
      }),
    };
  }

  @Post('coverage-options/:listingId/execute')
  @RequireScopes('agent:coverage:execute')
  @ApiOperation({
    summary:
      'Step 6: permitted execution. Expresses non-binding interest in a listing (Phase 4), but only after the ' +
      "mandate's transaction ceiling is checked against indicativeAmountMinor — this is the load-bearing check.",
  })
  async execute(
    @Req() req: RequestWithAuth,
    @Param('listingId') listingId: string,
    @Body() body: ExecuteDto,
  ) {
    return {
      interest: await this.agent.permittedExecution(
        auth(req),
        listingId,
        { amountMinor: body.indicativeAmountMinor, currency: body.currency },
        body.note,
      ),
    };
  }

  @Get('settlement/:transactionId')
  @RequireScopes('agent:settlement:read')
  @ApiOperation({ summary: 'Step 7: settlement information — read-only status of a settlement transaction.' })
  async settlementInformation(@Req() req: RequestWithAuth, @Param('transactionId') transactionId: string) {
    return { transaction: await this.agent.settlementInformation(auth(req), transactionId) };
  }
}
