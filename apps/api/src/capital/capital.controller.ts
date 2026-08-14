import { Controller, Get, Inject, Post, Body, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString, Length } from 'class-validator';
import type { AuthContext } from '@neo-lloyds/domain';
import { CapitalService } from './capital.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class SetCommitmentDto {
  @IsInt() @IsPositive() committedMinor: number;
  @IsString() @Length(3, 3) currency: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('capital-ledger')
@Controller('capital')
export class CapitalController {
  constructor(@Inject(CapitalService) private readonly capital: CapitalService) {}

  @Post('commitments')
  @RequireScopes('capital:manage')
  @RequireRoles('CAPITAL_PROVIDER')
  @ApiOperation({
    summary:
      "Set the caller's platform-wide committed capital ceiling. Replaces any existing commitment.",
  })
  async setCommitment(@Req() req: RequestWithAuth, @Body() body: SetCommitmentDto) {
    const commitment = await this.capital.setCommitment(auth(req), {
      amountMinor: body.committedMinor,
      currency: body.currency,
    });
    return { commitment };
  }

  @Get('commitments')
  @RequireScopes('capital:read')
  async getCommitment(@Req() req: RequestWithAuth) {
    return { commitment: await this.capital.getCommitment(auth(req)) };
  }

  @Get('exposure')
  @RequireScopes('capital:read')
  @ApiOperation({
    summary:
      'Committed / allocated / reserved / available capital, computed live from every syndication the caller participates in — the first cross-syndication view of a single provider\'s total exposure.',
  })
  async position(@Req() req: RequestWithAuth) {
    return { position: await this.capital.position(auth(req)) };
  }

  @Get('concentration')
  @RequireScopes('capital:read')
  @ApiOperation({
    summary:
      'Exposure concentration by risk class, jurisdiction, or counterparty. Industry, event and asset concentration are not yet computable — the risk graph does not carry those as structured listing attributes (docs/reports/phase-6.md).',
  })
  async concentration(
    @Req() req: RequestWithAuth,
    @Query('by') by: 'riskClass' | 'jurisdiction' | 'counterparty' = 'riskClass',
  ) {
    return { buckets: await this.capital.concentration(auth(req), by) };
  }
}
