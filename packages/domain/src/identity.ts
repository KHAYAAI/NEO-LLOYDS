import { AuthorizationError } from './errors.js';

/**
 * The nine market functions, granted explicitly and independently. No object
 * may play two roles implicitly (domain-model.md §1).
 */
export const MARKET_ROLES = [
  'RISK_ORIGINATOR',
  'BROKER',
  'UNDERWRITER',
  'SYNDICATE',
  'CAPITAL_PROVIDER',
  'REINSURER',
  'INSURER',
  'CLAIMS_ADMINISTRATOR',
  'SETTLEMENT_PROVIDER',
  'REGULATOR',
] as const;

export type MarketRole = (typeof MARKET_ROLES)[number];

export type OrganisationKind = 'COMPANY' | 'INDIVIDUAL' | 'AI_AGENT' | 'REGULATOR';

export type KybStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface Organisation {
  readonly id: string;
  readonly legalName: string;
  readonly kind: OrganisationKind;
  /** ISO-3166-1 alpha-2. Never defaulted (ADR-0004). */
  readonly jurisdiction: string;
  readonly kybStatus: KybStatus;
  readonly roles: readonly MarketRole[];
  readonly active: boolean;
  /** Required for AI_AGENT: the legally responsible principal. */
  readonly principalOrganisationId?: string;
}

/**
 * What an autonomous agent is permitted to do. An agent's authority is always
 * a subset of its principal's, and always bounded and expiring.
 */
export interface AgentMandate {
  readonly agentOrganisationId: string;
  readonly principalOrganisationId: string;
  readonly permittedActions: readonly string[];
  readonly maxTransactionValueMinor: number;
  readonly currency: string;
  readonly expiresAt: string;
}

export type SubjectKind = 'USER' | 'SERVICE' | 'AGENT';

export interface AuthContext {
  readonly organisationId: string;
  readonly subjectId: string;
  readonly subjectKind: SubjectKind;
  readonly roles: readonly MarketRole[];
  readonly scopes: readonly string[];
  readonly principalOrganisationId?: string;
  readonly mandate?: AgentMandate;
}

export function hasScope(ctx: AuthContext, scope: string): boolean {
  return ctx.scopes.includes(scope) || ctx.scopes.includes('*');
}

export function hasAnyRole(ctx: AuthContext, roles: readonly MarketRole[]): boolean {
  return roles.some((role) => ctx.roles.includes(role));
}

export function requireScope(ctx: AuthContext, scope: string): void {
  if (!hasScope(ctx, scope)) {
    throw new AuthorizationError(`Missing required scope: ${scope}`, {
      scope,
      subjectId: ctx.subjectId,
    });
  }
}

export function requireAnyRole(
  ctx: AuthContext,
  roles: readonly MarketRole[],
): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new AuthorizationError(
      `Organisation is not authorised for any of: ${roles.join(', ')}`,
      { required: roles, held: ctx.roles, organisationId: ctx.organisationId },
    );
  }
}

/**
 * Tenant isolation. A regulator may read across organisations — and every such
 * access is logged — but may never write outside its own.
 */
export function requireTenantAccess(
  ctx: AuthContext,
  resourceOrganisationId: string,
  access: 'READ' | 'WRITE',
): void {
  if (ctx.organisationId === resourceOrganisationId) return;
  if (access === 'READ' && ctx.roles.includes('REGULATOR')) return;

  throw new AuthorizationError(
    'Caller may not access resources belonging to another organisation',
    {
      callerOrganisationId: ctx.organisationId,
      resourceOrganisationId,
      access,
    },
  );
}

export interface AgentCheckOptions {
  /** In production configuration the principal must be KYB-verified. */
  readonly requireVerifiedPrincipal: boolean;
  readonly now: Date;
}

/**
 * Gate for every agent-initiated action. Enforced in the shared authorisation
 * layer, not in agent-specific convenience code, so there is no separate agent
 * path that can drift from the human one (security-model.md §4).
 */
export function assertAgentMayAct(
  ctx: AuthContext,
  action: string,
  valueMinor: number,
  principal: Organisation | undefined,
  options: AgentCheckOptions,
): void {
  if (ctx.subjectKind !== 'AGENT') return;

  const mandate = ctx.mandate;
  if (!mandate) {
    throw new AuthorizationError('An agent may not act without a mandate', {
      subjectId: ctx.subjectId,
    });
  }
  if (!principal || principal.id !== mandate.principalOrganisationId) {
    throw new AuthorizationError(
      'Agent mandate does not resolve to a known principal organisation',
      { subjectId: ctx.subjectId },
    );
  }
  if (!principal.active) {
    throw new AuthorizationError('Principal organisation is not active', {
      principalOrganisationId: principal.id,
    });
  }
  if (options.requireVerifiedPrincipal && principal.kybStatus !== 'VERIFIED') {
    throw new AuthorizationError(
      'Principal organisation has not completed KYB verification',
      { principalOrganisationId: principal.id, kybStatus: principal.kybStatus },
    );
  }
  if (Date.parse(mandate.expiresAt) <= options.now.getTime()) {
    throw new AuthorizationError('Agent mandate has expired', {
      expiresAt: mandate.expiresAt,
    });
  }
  if (!mandate.permittedActions.includes(action)) {
    throw new AuthorizationError('Action is outside the agent mandate', {
      action,
      permittedActions: mandate.permittedActions,
    });
  }
  if (valueMinor > mandate.maxTransactionValueMinor) {
    throw new AuthorizationError('Transaction value exceeds the agent mandate ceiling', {
      valueMinor,
      ceiling: mandate.maxTransactionValueMinor,
    });
  }
}

/** Approval bands. No automated path may bind an obligation (security-model.md §5). */
export type ApprovalBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export type ApprovalControl =
  | 'AUTOMATED_RECOMMENDATION'
  | 'HUMAN_UNDERWRITER'
  | 'SPECIALIST_UNDERWRITER'
  | 'SENIOR_GOVERNANCE';

export const APPROVAL_CONTROLS: Readonly<Record<ApprovalBand, ApprovalControl>> =
  Object.freeze({
    LOW: 'AUTOMATED_RECOMMENDATION',
    MEDIUM: 'HUMAN_UNDERWRITER',
    HIGH: 'SPECIALIST_UNDERWRITER',
    EXTREME: 'SENIOR_GOVERNANCE',
  });

export function controlFor(band: ApprovalBand): ApprovalControl {
  return APPROVAL_CONTROLS[band];
}

/** True only for bands where the system may proceed without a human decision. */
export function mayProceedWithoutHuman(band: ApprovalBand): boolean {
  return controlFor(band) === 'AUTOMATED_RECOMMENDATION';
}
