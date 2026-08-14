import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AuthContext } from '@neo-lloyds/domain';
import { UnderwritingService } from './underwriting.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class RiskFactorDto {
  @IsString() @MaxLength(100) key: string;
  @IsString() @MaxLength(300) description: string;
  @IsNumber() @Min(0) @Max(1) weight: number;
  @IsNumber() @Min(0) @Max(1) likelihood: number;
  @IsNumber() @Min(0) @Max(1) confidence: number;
  @IsIn(['OBSERVED', 'STATISTICAL_MODEL', 'EXPERT_JUDGEMENT', 'AI_INFERENCE', 'INSUFFICIENT_DATA'])
  basis: 'OBSERVED' | 'STATISTICAL_MODEL' | 'EXPERT_JUDGEMENT' | 'AI_INFERENCE' | 'INSUFFICIENT_DATA';
}

class AssessRiskDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RiskFactorDto) factors: RiskFactorDto[];
  @IsInt() @IsPositive() maximumEstimatedLossMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsInt() @Min(0) durationDays: number;
  @IsNumber() @Min(0) @Max(1) mitigationCoverage: number;
  @IsInt() @Min(0) correlatedRiskCount: number;
  @IsNumber() @Min(0) @Max(1) concentrationShare: number;
}

class ApprovalDto {
  @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
  @IsString() @MaxLength(1000) reason: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('underwriting')
@Controller('underwriting')
export class UnderwritingController {
  constructor(
    @Inject(UnderwritingService) private readonly underwriting: UnderwritingService,
  ) {}

  @Post('risks/:id/assess')
  @RequireScopes('underwriting:assess')
  @RequireRoles('UNDERWRITER')
  @ApiOperation({
    summary:
      'Produce an underwriting assessment: eligibility, band, suggested premium range, capital requirement, exclusions, conditions, required evidence. LOW band needs no human approval; MEDIUM/HIGH/EXTREME do.',
  })
  async assess(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: AssessRiskDto,
  ) {
    const assessment = await this.underwriting.assess(auth(req), id, {
      factors: body.factors,
      maximumEstimatedLoss: { amountMinor: body.maximumEstimatedLossMinor, currency: body.currency },
      durationDays: body.durationDays,
      mitigationCoverage: body.mitigationCoverage,
      correlatedRiskCount: body.correlatedRiskCount,
      concentrationShare: body.concentrationShare,
    });
    return { assessment };
  }

  @Get('risks/:id/assessment')
  @RequireScopes('underwriting:read')
  async getAssessment(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { assessment: await this.underwriting.getAssessment(auth(req), id) };
  }

  @Post('risks/:id/approve')
  @RequireScopes('underwriting:approve')
  @RequireRoles('UNDERWRITER')
  @ApiOperation({
    summary:
      'Record a human underwriting decision. Required before any MEDIUM/HIGH/EXTREME assessment may proceed to binding; a LOW assessment does not need this call.',
  })
  async approve(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ApprovalDto,
  ) {
    const approval = await this.underwriting.approve(auth(req), id, body.decision, body.reason);
    return { approval };
  }

  @Get('risks/:id/clearance')
  @RequireScopes('underwriting:read')
  @ApiOperation({
    summary:
      'Check whether a risk is clear to proceed (200) or blocked (422/APPROVAL_REQUIRED, STALE_APPROVAL, or NOT_APPROVED).',
  })
  async clearance(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.underwriting.requireClearance(auth(req), id);
    return { cleared: true };
  }
}
