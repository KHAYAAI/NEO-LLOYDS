import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, createLocalJWKSet, jwtVerify, type JWTPayload, type JSONWebKeySet } from 'jose';

/**
 * The authenticator OIDC replaces, per docs/security-model.md §10:
 * `ApiCredentialGuard.resolve` gains a second path (an OIDC ID token)
 * alongside the existing `<keyId>.<secret>` credential, and both build the
 * same `AuthContext` shape — every authorisation check downstream is
 * unchanged.
 *
 * This is real signature/issuer/audience/expiry verification against
 * whatever OIDC provider is configured — it is NOT a simulated or stubbed
 * check. What is honestly still missing, because it requires an external
 * account this repository cannot provide, is a *registered* identity
 * provider (an Okta/Azure AD/Google Workspace tenant with a real client
 * id) to actually issue tokens against; see the README this ships with.
 */
export interface OidcConfig {
  issuer: string;
  audience?: string;
  /** Fetch keys live from `${issuer}/.well-known/jwks.json`-style endpoint. */
  jwksUrl?: string;
  /** Static JWKS JSON — for offline/dev/test verification without network access. */
  jwksStatic?: JSONWebKeySet;
}

export function loadOidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | undefined {
  const issuer = env.OIDC_ISSUER_URL;
  if (!issuer) return undefined;

  const jwksStaticJson = env.OIDC_JWKS_STATIC_JSON;
  return {
    issuer,
    audience: env.OIDC_AUDIENCE,
    jwksUrl: env.OIDC_JWKS_URL,
    jwksStatic: jwksStaticJson ? (JSON.parse(jwksStaticJson) as JSONWebKeySet) : undefined,
  };
}

export interface VerifiedOidcIdentity {
  issuer: string;
  subject: string;
  email?: string;
}

@Injectable()
export class OidcVerifier {
  private readonly logger = new Logger(OidcVerifier.name);
  private readonly config?: OidcConfig;
  private readonly keySet: ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet> | undefined;

  constructor(config: OidcConfig | undefined = loadOidcConfigFromEnv()) {
    this.config = config;
    if (!config) return;
    if (config.jwksStatic) {
      this.keySet = createLocalJWKSet(config.jwksStatic);
    } else if (config.jwksUrl) {
      this.keySet = createRemoteJWKSet(new URL(config.jwksUrl));
    } else {
      this.keySet = createRemoteJWKSet(new URL(`${config.issuer.replace(/\/$/, '')}/.well-known/jwks.json`));
    }
  }

  get enabled(): boolean {
    return this.config !== undefined;
  }

  /** Throws (via jose) on a bad signature, wrong issuer/audience, or expiry. */
  async verify(idToken: string): Promise<VerifiedOidcIdentity> {
    if (!this.config || !this.keySet) {
      throw new Error('OIDC is not configured (OIDC_ISSUER_URL unset)');
    }

    const { payload } = await jwtVerify(idToken, this.keySet, {
      issuer: this.config.issuer,
      audience: this.config.audience,
    });

    const subject = requireStringClaim(payload, 'sub');
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    this.logger.debug(`Verified OIDC token for subject ${subject}`);
    return { issuer: this.config.issuer, subject, email };
  }
}

function requireStringClaim(payload: JWTPayload, claim: keyof JWTPayload): string {
  const value = payload[claim];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`OIDC token missing required claim: ${String(claim)}`);
  }
  return value;
}
