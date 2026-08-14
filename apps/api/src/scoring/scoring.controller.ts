import { Body, Controller, Inject, Post, Param, Req } from '@nestjs/common';
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
import { ScoringService } from './scoring.service.js';
import { RequireScopes, type RequestWithAuth } from '../common/auth.js';

class RiskFactorDto {
  @IsString() @MaxLength(100) key: string;
  @IsString() @MaxLength(300) description: string;
  @IsNumber() @Min(0) @Max(1) weight: number;
  @IsNumber() @Min(0) @Max(1) likelihood: number;
  @IsNumber() @Min(0) @Max(1) confidence: number;
  @IsIn(['OBSERVED', 'STATISTICAL_MODEL', 'EXPERT_JUDGEMENT', 'AI_INFERENCE', 'INSUFFICIENT_DATA'])
  basis: 'OBSERVED' | 'STATISTICAL_MODEL' | 'EXPERT_JUDGEMENT' | 'AI_INFERENCE' | 'INSUFFICIENT_DATA';
}

class ScoreRiskDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RiskFactorDto) factors: RiskFactorDto[];
  @IsInt() @IsPositive() maximumEstimatedLossMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsInt() @Min(0) durationDays: number;
  @IsNumber() @Min(0) @Max(1) mitigationCoverage: number;
  @IsInt() @Min(0) correlatedRiskCount: number;
  @IsNumber() @Min(0) @Max(1) concentrationShare: number;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('scoring')
@Controller('scoring')
export class ScoringController {
  constructor(@Inject(ScoringService) private readonly scoring: ScoringService) {}

  @Post('risks/:id')
  @RequireScopes('scoring:compute')
  @ApiOperation({
    summary:
      'Deterministic risk score: probability, severity, expected loss, correlation, concentration, mitigation — each with explicit confidence. Reproducible: identical input always yields identical output.',
  })
  async score(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ScoreRiskDto,
  ) {
    return { score: await this.scoring.score(auth(req), id, body) };
  }
}
