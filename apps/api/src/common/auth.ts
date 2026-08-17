import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  hasScope,
  type AuthContext,
  type MarketRole,
} from '@neo-lloyds/domain';
import {
  IDENTITY_REPOSITORY,
  CLOCK,
  type Clock,
  type IdentityRepository,
} from '../persistence/ports.js';

/**
 * Credential secrets are stored only as a salted SHA-256 hash and compared in
 * constant time (security-model.md §2). The plaintext is returned once at
 * creation and is never retrievable afterwards.
 */
export function hashSecret(secret: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${secret}`).digest('hex');
}

export function generateCredential(): { keyId: string; secret: string; salt: string } {
  return {
    keyId: `nlk_${randomBytes(9).toString('hex')}`,
    secret: randomBytes(32).toString('hex'),
    salt: randomBytes(16).toString('hex'),
  };
}

function secretMatches(presented: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(presented, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const REQUIRED_SCOPES = 'neolloyds:scopes';
export const REQUIRED_ROLES = 'neolloyds:roles';

export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES, scopes);
export const RequireRoles = (...roles: MarketRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);

/** Marks a route as reachable without a credential (health, ontology). */
export const PUBLIC_ROUTE = 'neolloyds:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export interface RequestWithAuth {
  auth?: AuthContext;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}

/**
 * Resolves a credential to an {@link AuthContext} and enforces scope and
 * market-role requirements. There is no anonymous mutation path, and agents go
 * through exactly the same guard as humans — there is no separate agent path
 * that could drift (security-model.md §4).
 */
@Injectable()
export class ApiCredentialGuard implements CanActivate {
  private readonly logger = new Logger(ApiCredentialGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [handler, controller])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = await this.resolve(request);
    request.auth = auth;

    const scopes =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES, [handler, controller]) ??
      [];
    for (const scope of scopes) {
      if (!hasScope(auth, scope)) {
        this.logger.warn(
          `Forbidden: organisation ${auth.organisationId} missing scope ${scope} on ${request.method ?? ''} ${request.url ?? ''}`,
        );
        throw new ForbiddenException(`Missing required scope: ${scope}`);
      }
    }

    const roles =
      this.reflector.getAllAndOverride<MarketRole[]>(REQUIRED_ROLES, [
        handler,
        controller,
      ]) ?? [];
    if (roles.length > 0 && !roles.some((role) => auth.roles.includes(role))) {
      this.logger.warn(
        `Forbidden: organisation ${auth.organisationId} lacks any of [${roles.join(', ')}] on ${request.method ?? ''} ${request.url ?? ''}`,
      );
      throw new ForbiddenException(
        `Organisation is not authorised for any of: ${roles.join(', ')}`,
      );
    }

    return true;
  }

  /**
   * Every rejection here is logged at WARN with the presented key id (never
   * the secret) — this is the minimum signal an operator needs to notice a
   * credential-guessing or credential-stuffing attempt before it succeeds.
   * The client-facing message stays uniform (`Invalid credential`) so a
   * caller can never distinguish "unknown key" from "wrong secret" — only
   * the server-side log, which the caller cannot read, is more specific.
   */
  private async resolve(request: RequestWithAuth): Promise<AuthContext> {
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException('An API credential is required');
    }

    const token = value.slice('Bearer '.length);
    const separator = token.indexOf('.');
    if (separator < 0) {
      this.logger.warn('Rejected malformed credential (no keyId separator)');
      throw new UnauthorizedException('Malformed credential: expected <keyId>.<secret>');
    }

    const keyId = token.slice(0, separator);
    const secret = token.slice(separator + 1);

    const credential = await this.identity.findCredentialByKeyId(keyId);
    if (!credential || !secretMatches(secret, credential.secretSalt, credential.secretHash)) {
      this.logger.warn(`Rejected invalid credential for keyId ${keyId}`);
      // Same message for unknown key and bad secret: do not reveal which.
      throw new UnauthorizedException('Invalid credential');
    }
    if (credential.revokedAt) {
      this.logger.warn(`Rejected revoked credential ${keyId}`);
      throw new UnauthorizedException('Credential has been revoked');
    }
    if (credential.expiresAt && credential.expiresAt.getTime() <= this.clock.now().getTime()) {
      this.logger.warn(`Rejected expired credential ${keyId}`);
      throw new UnauthorizedException('Credential has expired');
    }

    const organisation = await this.identity.findOrganisation(credential.organisationId);
    if (!organisation || !organisation.active) {
      this.logger.warn(`Rejected credential ${keyId} for inactive/unknown organisation`);
      throw new UnauthorizedException('Organisation is not active');
    }

    const mandate =
      organisation.kind === 'AI_AGENT'
        ? await this.identity.findActiveMandate(organisation.id)
        : undefined;

    return {
      organisationId: organisation.id,
      subjectId: credential.id,
      subjectKind: credential.subjectKind,
      roles: organisation.roles,
      scopes: credential.scopes,
      ...(organisation.principalOrganisationId
        ? { principalOrganisationId: organisation.principalOrganisationId }
        : {}),
      ...(mandate ? { mandate } : {}),
    };
  }
}
