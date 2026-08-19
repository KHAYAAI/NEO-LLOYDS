import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  MARKET_ROLES,
  type AuthContext,
  type MarketRole,
  type Organisation,
} from '@neo-lloyds/domain';
import { isConfiguredJurisdiction } from '@neo-lloyds/config';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
} from '../persistence/ports.js';
import { AuditService } from '../common/audit.service.js';
import { generateCredential, hashSecret } from '../common/auth.js';
import type { KybProvider, SanctionsProvider } from '../compliance/providers.js';
import { KYB_PROVIDER, SANCTIONS_PROVIDER } from '../compliance/tokens.js';

const JURISDICTION = /^[A-Z]{2}$/;

@Injectable()
export class IdentityService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(KYB_PROVIDER) private readonly kybProvider: KybProvider,
    @Inject(SANCTIONS_PROVIDER) private readonly sanctionsProvider: SanctionsProvider,
  ) {}

  async createOrganisation(
    ctx: AuthContext,
    input: {
      legalName: string;
      kind: Organisation['kind'];
      jurisdiction: string;
      principalOrganisationId?: string;
    },
  ): Promise<Organisation> {
    if (!JURISDICTION.test(input.jurisdiction)) {
      throw new DomainError(
        'jurisdiction must be an ISO-3166-1 alpha-2 code; there is no default (ADR-0004)',
        'INVALID_JURISDICTION',
        { jurisdiction: input.jurisdiction },
      );
    }

    // An autonomous agent is never a principal in its own right: legal
    // responsibility rests with a real organisation (domain-model.md §1).
    if (input.kind === 'AI_AGENT') {
      if (!input.principalOrganisationId) {
        throw new DomainError(
          'An AI_AGENT organisation requires a principalOrganisationId',
          'AGENT_REQUIRES_PRINCIPAL',
        );
      }
      const principal = await this.repository.findOrganisation(
        input.principalOrganisationId,
      );
      if (!principal) {
        throw new DomainError('Principal organisation does not exist', 'UNKNOWN_PRINCIPAL', {
          principalOrganisationId: input.principalOrganisationId,
        });
      }
      if (principal.kind === 'AI_AGENT') {
        throw new DomainError(
          'An agent may not be the principal of another agent',
          'AGENT_CHAIN_FORBIDDEN',
        );
      }
    }

    const organisation = await this.repository.createOrganisation({
      id: randomUUID(),
      ...input,
    });

    // Registration is never blocked by an unconfigured jurisdiction — ADR-0004
    // requires *a* jurisdiction, not a *configured* one, and this platform
    // must stay globally deployable. But the gap is worth recording, not
    // hidden: an organisation in a jurisdiction with no module (GET
    // /jurisdictions) has no published data-residency/KYC-AML/cross-border
    // guidance behind it yet.
    const jurisdictionConfigured = isConfiguredJurisdiction(input.jurisdiction);

    await this.audit.record({
      ctx,
      action: 'identity.organisation.create',
      subjectType: 'Organisation',
      subjectId: organisation.id,
      decision: 'ALLOWED',
      reason: jurisdictionConfigured
        ? 'Organisation registered'
        : `Organisation registered in jurisdiction "${input.jurisdiction}", which has no configured jurisdiction module yet`,
      after: organisation,
    });

    return organisation;
  }

  async grantRole(
    ctx: AuthContext,
    organisationId: string,
    role: MarketRole,
  ): Promise<Organisation> {
    if (!MARKET_ROLES.includes(role)) {
      throw new DomainError('Unknown market role', 'UNKNOWN_ROLE', { role });
    }

    const before = await this.repository.findOrganisation(organisationId);
    if (!before) throw new NotFoundException('Organisation not found');

    const after = await this.repository.grantRole(organisationId, role, ctx.subjectId);

    await this.audit.record({
      ctx,
      action: 'identity.role.grant',
      subjectType: 'Organisation',
      subjectId: organisationId,
      decision: 'ALLOWED',
      reason: `Granted market role ${role}`,
      before,
      after,
    });

    return after;
  }

  async setKybStatus(
    ctx: AuthContext,
    organisationId: string,
    status: Organisation['kybStatus'],
  ): Promise<Organisation> {
    const before = await this.repository.findOrganisation(organisationId);
    if (!before) throw new NotFoundException('Organisation not found');

    const after = await this.repository.setKybStatus(organisationId, status);

    await this.audit.record({
      ctx,
      action: 'identity.kyb.update',
      subjectType: 'Organisation',
      subjectId: organisationId,
      decision: 'ALLOWED',
      reason: `KYB status set to ${status}`,
      before,
      after,
      policy: 'KYB_MANUAL_REVIEW',
    });

    return after;
  }

  /**
   * Runs the KYB and sanctions-screening providers and records what they
   * report — nothing more. This is deliberately *not* an authorisation
   * decision: `kybStatus` only ever changes via the explicit `setKybStatus`
   * admin action above, unchanged by this method. With the shipped
   * `NullKybProvider`/`NullSanctionsProvider` (docs/security-model.md §8:
   * no real vendor is integrated), this records an honest "not screened"
   * result — it does not simulate a pass.
   */
  async runComplianceChecks(ctx: AuthContext, organisationId: string) {
    const organisation = await this.repository.findOrganisation(organisationId);
    if (!organisation) throw new NotFoundException('Organisation not found');

    const [kyb, sanctions] = await Promise.all([
      this.kybProvider.check({
        organisationId,
        legalName: organisation.legalName,
        jurisdiction: organisation.jurisdiction,
      }),
      this.sanctionsProvider.screen({ organisationId, legalName: organisation.legalName }),
    ]);

    await this.audit.record({
      ctx,
      action: 'identity.compliance.check',
      subjectType: 'Organisation',
      subjectId: organisationId,
      decision: 'ALLOWED',
      reason: `Compliance check run: KYB=${kyb.verdict} via ${kyb.providerId}; sanctions screened=${sanctions.screened} via ${sanctions.providerId} (${sanctions.hits.length} hit(s))`,
      after: { kyb, sanctions },
      policy: 'COMPLIANCE_CHECK_INFORMATIONAL',
    });

    return { kyb, sanctions };
  }

  /**
   * Issues a credential. The plaintext secret is returned exactly once and is
   * never recoverable afterwards — only a salted hash is stored.
   */
  async issueCredential(
    ctx: AuthContext,
    input: {
      organisationId: string;
      label: string;
      scopes: string[];
      subjectKind?: 'USER' | 'SERVICE' | 'AGENT';
      expiresAt?: string;
    },
  ): Promise<{ keyId: string; secret: string; scopes: string[] }> {
    const organisation = await this.repository.findOrganisation(input.organisationId);
    if (!organisation) throw new NotFoundException('Organisation not found');

    const { keyId, secret, salt } = generateCredential();

    await this.repository.createCredential({
      id: randomUUID(),
      keyId,
      secretHash: hashSecret(secret, salt),
      secretSalt: salt,
      organisationId: input.organisationId,
      label: input.label,
      scopes: input.scopes,
      subjectKind: input.subjectKind ?? 'SERVICE',
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });

    await this.audit.record({
      ctx,
      action: 'identity.credential.issue',
      subjectType: 'ApiCredential',
      subjectId: keyId,
      decision: 'ALLOWED',
      reason: `Credential issued: ${input.label}`,
      // The secret is deliberately absent from the audit record.
      after: { keyId, scopes: input.scopes, organisationId: input.organisationId },
    });

    return { keyId, secret, scopes: input.scopes };
  }

  /**
   * Links a human to an organisation via a real, already-configured OIDC
   * provider (security-model.md §10) -- there is no self-registration path.
   * An admin (identity:admin) must already know the subject's `sub` claim
   * at the issuer, exactly like issuing an API credential is an explicit
   * admin action, not something a caller grants itself.
   */
  async provisionOidcUser(
    ctx: AuthContext,
    input: {
      organisationId: string;
      email: string;
      displayName: string;
      scopes: string[];
      oidcIssuer: string;
      oidcSubject: string;
    },
  ): Promise<{ id: string; email: string; scopes: string[] }> {
    const organisation = await this.repository.findOrganisation(input.organisationId);
    if (!organisation) throw new NotFoundException('Organisation not found');

    const user = await this.repository.createUser({
      id: randomUUID(),
      organisationId: input.organisationId,
      email: input.email,
      displayName: input.displayName,
      scopes: input.scopes,
      oidcIssuer: input.oidcIssuer,
      oidcSubject: input.oidcSubject,
    });

    await this.audit.record({
      ctx,
      action: 'identity.user.provision_oidc',
      subjectType: 'User',
      subjectId: user.id,
      decision: 'ALLOWED',
      reason: `OIDC-linked user provisioned: ${input.email}`,
      after: { id: user.id, email: user.email, scopes: user.scopes, organisationId: input.organisationId },
    });

    return { id: user.id, email: user.email, scopes: user.scopes };
  }

  async revokeCredential(ctx: AuthContext, keyId: string): Promise<void> {
    const credential = await this.repository.findCredentialByKeyId(keyId);
    if (!credential) throw new NotFoundException('Credential not found');

    await this.repository.revokeCredential(keyId);
    await this.audit.record({
      ctx,
      action: 'identity.credential.revoke',
      subjectType: 'ApiCredential',
      subjectId: keyId,
      decision: 'ALLOWED',
      reason: 'Credential revoked',
    });
  }

  async createMandate(
    ctx: AuthContext,
    input: {
      agentOrganisationId: string;
      permittedActions: string[];
      maxTransactionValueMinor: number;
      currency: string;
      expiresAt: string;
    },
  ) {
    const agent = await this.repository.findOrganisation(input.agentOrganisationId);
    if (!agent) throw new NotFoundException('Agent organisation not found');
    if (agent.kind !== 'AI_AGENT' || !agent.principalOrganisationId) {
      throw new DomainError(
        'Mandates may only be granted to an AI_AGENT organisation with a principal',
        'NOT_AN_AGENT',
        { organisationId: agent.id },
      );
    }
    // Only the principal may widen or narrow its agent's authority.
    if (ctx.organisationId !== agent.principalOrganisationId) {
      throw new DomainError(
        'Only the principal organisation may issue a mandate to its agent',
        'FORBIDDEN',
        { principalOrganisationId: agent.principalOrganisationId },
      );
    }

    const mandate = await this.repository.createMandate({
      id: randomUUID(),
      agentOrganisationId: agent.id,
      principalOrganisationId: agent.principalOrganisationId,
      permittedActions: input.permittedActions,
      maxTransactionValueMinor: input.maxTransactionValueMinor,
      currency: input.currency,
      expiresAt: input.expiresAt,
    });

    await this.audit.record({
      ctx,
      action: 'identity.mandate.create',
      subjectType: 'AgentMandate',
      subjectId: agent.id,
      decision: 'ALLOWED',
      reason: 'Agent mandate issued by principal',
      after: mandate,
      policy: 'AGENT_MANDATE',
    });

    return mandate;
  }

  async getOrganisation(id: string): Promise<Organisation> {
    const organisation = await this.repository.findOrganisation(id);
    if (!organisation) throw new NotFoundException('Organisation not found');
    return organisation;
  }

  async listOrganisations(): Promise<Organisation[]> {
    return this.repository.listOrganisations();
  }
}
