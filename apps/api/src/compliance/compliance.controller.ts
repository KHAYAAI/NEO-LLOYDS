import { Body, Controller, Headers, HttpCode, Inject, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import type { AuthContext } from '@neo-lloyds/domain';
import { Public, RequireScopes, type RequestWithAuth } from '../common/auth.js';
import { AuditService } from '../common/audit.service.js';
import { WALLET_SCREENING_PROVIDER, VERIFICATION_SESSION_PROVIDER } from './tokens.js';
import type { VerificationSessionProvider, WalletScreeningProvider } from './providers.js';
import { verifyDiditWebhookSignature, type DiditWebhookPayload } from './didit.js';

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
    @Inject(AuditService) private readonly audit: AuditService,
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

  /**
   * Receives Didit verification-session status changes. `@Public()` because
   * Didit cannot present one of this API's own bearer credentials — the
   * HMAC signature below IS the authentication, same strength requirement,
   * different mechanism (this is the same shape as Stripe's webhook
   * signing, not a weaker substitute for a credential).
   *
   * `vendor_data` is expected to be the caller's organisationId, by
   * convention only — this server does not itself set it, whatever value
   * was passed as `vendorData` to POST /compliance/verification-sessions
   * is what comes back here. If a caller didn't set it to an
   * organisationId, the audit record below still gets written (never
   * silently dropped) with whatever string Didit echoes back, or `null`.
   *
   * Deliberately does not touch `kybStatus`: same rule as
   * `KybProvider`/`SanctionsProvider` (providers.ts's doc comment) — a
   * provider result is recorded, never auto-applied as a decision. Turning
   * "Didit says Approved" into an actual status change is a real feature
   * this endpoint does not implement; do it as an explicit follow-up read
   * of the audit log, not an inference from this handler having run.
   */
  @Public()
  @Post('webhooks/didit')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Didit webhook receiver for verification-session status changes. Authenticated by HMAC-SHA256 signature (X-Signature header) over the raw body, not a bearer credential.',
  })
  async diditWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-signature') signature?: string,
  ) {
    const secret = process.env['DIDIT_WEBHOOK_SECRET'];
    if (!secret) {
      throw new Error(
        'DIDIT_WEBHOOK_SECRET is not configured -- cannot verify incoming Didit webhooks. ' +
          'Get it from the webhook destination in your Didit dashboard and set it.',
      );
    }
    if (!req.rawBody || !verifyDiditWebhookSignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(req.rawBody.toString('utf8')) as DiditWebhookPayload;

    const systemCtx: AuthContext = {
      organisationId: payload.vendor_data ?? 'unknown',
      subjectId: 'didit-webhook',
      subjectKind: 'SERVICE',
      roles: [],
      scopes: [],
    };

    await this.audit.record({
      ctx: systemCtx,
      action: 'compliance.verification-session.webhook',
      subjectType: 'VerificationSession',
      subjectId: payload.session_id,
      decision: 'ALLOWED',
      reason: `Didit ${payload.webhook_type}: status=${payload.status}`,
      after: payload,
    });

    return { received: true };
  }
}
