import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsPositive, IsString, Length, MaxLength } from 'class-validator';
import { CLAIM_STATUSES, type AuthContext } from '@neo-lloyds/domain';
import { ClaimsService } from './claims.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class ReportClaimDto {
  @IsString() syndicationId: string;
  @IsString() riskId: string;
  @IsString() @MaxLength(2000) incidentDescription: string;
}

class EvidenceDto {
  @IsString() @MaxLength(500) evidenceRef: string;
}

class AdvanceClaimDto {
  @IsIn(CLAIM_STATUSES as unknown as string[]) to: (typeof CLAIM_STATUSES)[number];
}

class CalculateLossDto {
  @IsInt() @IsPositive() claimedLossMinor: number;
  @IsString() @Length(3, 3) currency: string;
}

class DecideClaimDto {
  @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
  @IsString() @MaxLength(1000) reason: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Post()
  @RequireScopes('claims:report')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  @ApiOperation({ summary: 'Report an incident against a BOUND syndication. Starts REPORTED.' })
  async report(@Req() req: RequestWithAuth, @Body() body: ReportClaimDto) {
    return { claim: await this.claims.report(auth(req), body) };
  }

  @Post(':id/evidence')
  @RequireScopes('claims:write')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER', 'CLAIMS_ADMINISTRATOR')
  async addEvidence(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: EvidenceDto) {
    return { claim: await this.claims.addEvidence(auth(req), id, body.evidenceRef) };
  }

  @Post(':id/advance')
  @RequireScopes('claims:process')
  @RequireRoles('CLAIMS_ADMINISTRATOR')
  @ApiOperation({
    summary:
      'Advance through REPORTED -> EVIDENCE_COLLECTED -> VERIFIED -> COVERAGE_CONFIRMED. COVERAGE_CONFIRMED requires the syndication to be BOUND.',
  })
  async advance(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: AdvanceClaimDto) {
    return { claim: await this.claims.advance(auth(req), id, body.to) };
  }

  @Post(':id/loss')
  @RequireScopes('claims:process')
  @RequireRoles('CLAIMS_ADMINISTRATOR')
  @ApiOperation({
    summary:
      "THE COVERAGE TEST. Checks the claimed loss against the syndication's bound capacity, net of every prior approved/settled claim on it, then classifies AUTO or HUMAN_REVIEW against the configured threshold. AUTO claims are approved and paid out immediately; HUMAN_REVIEW claims move to AWAITING_APPROVAL.",
  })
  async calculateLoss(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: CalculateLossDto) {
    return {
      claim: await this.claims.calculateLoss(auth(req), id, {
        amountMinor: body.claimedLossMinor,
        currency: body.currency,
      }),
    };
  }

  @Post(':id/decide')
  @RequireScopes('claims:approve')
  @RequireRoles('CLAIMS_ADMINISTRATOR')
  @ApiOperation({ summary: 'Record a human decision on a claim AWAITING_APPROVAL.' })
  async decide(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: DecideClaimDto) {
    return { claim: await this.claims.decide(auth(req), id, body.decision, body.reason) };
  }

  @Post(':id/settle')
  @RequireScopes('claims:settle')
  @RequireRoles('CLAIMS_ADMINISTRATOR', 'SETTLEMENT_PROVIDER')
  @ApiOperation({
    summary:
      'Marks an APPROVED claim SETTLED. Test settlement infrastructure only — see docs/reports/phase-7.md for what real settlement (Phase 10) requires.',
  })
  async settle(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { claim: await this.claims.settle(auth(req), id) };
  }

  @Get(':id')
  @RequireScopes('claims:read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { claim: await this.claims.get(auth(req), id) };
  }

  @Get(':id/payouts')
  @RequireScopes('claims:read')
  @ApiOperation({ summary: "Each capital provider's exact share of an approved claim's payout." })
  async payouts(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { payouts: await this.claims.listPayouts(auth(req), id) };
  }

  @Get('by-syndication/:syndicationId')
  @RequireScopes('claims:read')
  async listBySyndication(@Req() req: RequestWithAuth, @Param('syndicationId') syndicationId: string) {
    return { claims: await this.claims.listBySyndication(auth(req), syndicationId) };
  }
}
