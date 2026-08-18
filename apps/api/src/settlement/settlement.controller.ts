import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';
import { SETTLEMENT_METHODS, type AuthContext, type SettlementMethod } from '@neo-lloyds/domain';
import { SettlementService } from './settlement.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class InitiateSettlementDto {
  @IsIn(SETTLEMENT_METHODS as unknown as string[]) method: SettlementMethod;
  @IsInt() @IsPositive() grossAmountMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsOptional() @IsString() claimPayoutOrganisationId?: string;
  @IsOptional() @IsString() claimPayoutClaimId?: string;
  @IsOptional() @IsInt() @Min(0) feeFlatMinor?: number;
  @IsOptional() @IsInt() @Min(0) feeBps?: number;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('settlement')
@Controller('settlement')
export class SettlementController {
  constructor(@Inject(SettlementService) private readonly settlement: SettlementService) {}

  @Post('transactions')
  @RequireScopes('settlement:write')
  @RequireRoles('CLAIMS_ADMINISTRATOR', 'SETTLEMENT_PROVIDER')
  @ApiOperation({
    summary:
      'Initiates a settlement transaction: computes the fee, records the transaction, and submits it to the ' +
      'configured SettlementProvider (today: a Null provider that simulates instant success — see docs/reports/phase-10.md). ' +
      'No cryptocurrency is hard-coded; STABLECOIN is a method a future provider could implement.',
  })
  async initiate(@Req() req: RequestWithAuth, @Body() body: InitiateSettlementDto) {
    const transaction = await this.settlement.initiate(auth(req), {
      claimPayoutOrganisationId: body.claimPayoutOrganisationId ?? null,
      claimPayoutClaimId: body.claimPayoutClaimId ?? null,
      method: body.method,
      grossAmount: { amountMinor: body.grossAmountMinor, currency: body.currency },
      ...(body.feeFlatMinor !== undefined || body.feeBps !== undefined
        ? { feeConfig: { flatMinor: body.feeFlatMinor ?? 0, bps: body.feeBps ?? 0 } }
        : {}),
    });
    return { transaction };
  }

  @Get('transactions/:id')
  @RequireScopes('settlement:read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { transaction: await this.settlement.get(auth(req), id) };
  }

  @Get('transactions')
  @RequireScopes('settlement:read')
  async list(@Req() req: RequestWithAuth) {
    return { transactions: await this.settlement.list(auth(req)) };
  }
}
