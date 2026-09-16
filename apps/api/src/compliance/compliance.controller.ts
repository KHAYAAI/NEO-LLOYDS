import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { AuthContext } from '@neo-lloyds/domain';
import { RequireScopes, type RequestWithAuth } from '../common/auth.js';
import { WALLET_SCREENING_PROVIDER, VERIFICATION_SESSION_PROVIDER } from './tokens.js';
import type { VerificationSessionProvider, WalletScreeningProvider } from './providers.js';

class WalletScreeningDto {
  @IsString() walletAddress: string;
  @IsString() blockchain: string;
}

class VerificationSessionDto {
  @IsString() workflowId: string;
  @IsString() vendorData: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

/**
 * Two of the three Didit capabilities beyond KYB/sanctions
 * (docs/security-model.md §8): wallet screening (Travel Rule
 * counterparty due diligence) is a synchronous check, exposed here
 * directly. Verification-session creation (bank-account-ownership once
 * enabled, or individual KYC) is a hosted, redirect-based flow — this
 * endpoint only starts it and hands back a URL; there is no webhook
 * receiver anywhere in this codebase to learn the outcome yet, so a
 * created session's result must be checked in the Didit dashboard today.
 */
@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(
    @Inject(WALLET_SCREENING_PROVIDER) private readonly walletScreening: WalletScreeningProvider,
    @Inject(VERIFICATION_SESSION_PROVIDER) private readonly verificationSessions: VerificationSessionProvider,
  ) {}

  @Post('wallet-screening')
  @RequireScopes('identity:admin')
  @ApiOperation({
    summary:
      'Screen a crypto wallet address for sanctions/AML risk before an on-chain settlement leg (FATF Travel Rule). Not yet wired into SettlementService -- see WalletScreeningProvider doc comment.',
  })
  async screenWallet(@Req() req: RequestWithAuth, @Body() body: WalletScreeningDto) {
    auth(req);
    return { result: await this.walletScreening.screenWallet(body) };
  }

  @Post('verification-sessions')
  @RequireScopes('identity:admin')
  @ApiOperation({
    summary:
      'Start a hosted Didit verification session (KYC document/liveness, or bank-account-ownership once enabled) and return its URL. Completing the loop needs a webhook receiver this codebase does not have yet -- check the session outcome in the Didit dashboard.',
  })
  async createVerificationSession(@Req() req: RequestWithAuth, @Body() body: VerificationSessionDto) {
    auth(req);
    return { session: await this.verificationSessions.createSession(body) };
  }
}
