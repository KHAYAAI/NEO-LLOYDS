import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { AppModule } from '../src/app.module.js';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter.js';
import { SimulationNoticeInterceptor } from '../src/common/simulation.interceptor.js';
import { hardenApp } from '../src/common/harden.js';
import { OidcVerifier } from '../src/common/oidc.js';
import {
  InMemoryAuditRepository,
  InMemoryGraphRepository,
  InMemoryIdentityRepository,
  InMemoryMarketplaceRepository,
  InMemorySubmissionRepository,
  InMemoryCapitalRepository,
  InMemoryClaimsRepository,
  InMemoryReinsuranceRepository,
  InMemorySettlementRepository,
  InMemorySimulationRepository,
  InMemorySyndicationRepository,
  InMemoryUnderwritingRepository,
  SystemClock,
} from '../src/persistence/in-memory.js';

/**
 * Verifies the OIDC authenticator described in docs/security-model.md §10:
 * ApiCredentialGuard.resolve's second path, alongside the existing
 * <keyId>.<secret> credential. Signs real JWTs against a locally-generated
 * RS256 key pair (no network access to a real IdP is available or needed --
 * `jose`'s signature/issuer/audience/expiry verification is exercised for
 * real, only the key distribution is swapped for a static JWKS).
 */
const ISSUER = 'https://issuer.test';
const AUDIENCE = 'neo-lloyds-api';

const identity = new InMemoryIdentityRepository();
const audit = new InMemoryAuditRepository();
const graphRepo = new InMemoryGraphRepository();
const submissionRepo = new InMemorySubmissionRepository();
const underwritingRepo = new InMemoryUnderwritingRepository();
const marketplaceRepo = new InMemoryMarketplaceRepository();
const syndicationRepo = new InMemorySyndicationRepository();
const capitalRepo = new InMemoryCapitalRepository();
const claimsRepo = new InMemoryClaimsRepository();
const simulationRepo = new InMemorySimulationRepository();
const reinsuranceRepo = new InMemoryReinsuranceRepository();
const settlementRepo = new InMemorySettlementRepository();

let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication['getHttpServer']>;
let privateKey: KeyLike;
let orgId: string;

async function sign(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

beforeAll(async () => {
  const { publicKey, privateKey: sk } = await generateKeyPair('RS256');
  privateKey = sk;
  const jwk = await exportJWK(publicKey);

  const oidc = new OidcVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksStatic: { keys: [{ ...jwk, alg: 'RS256', use: 'sig', kid: 'test-key' }] },
  });

  const org = await identity.createOrganisation({
    id: 'org-oidc-test',
    legalName: 'OIDC Test Co',
    kind: 'COMPANY',
    jurisdiction: 'ZA',
  });
  await identity.grantRole(org.id, 'RISK_ORIGINATOR');
  orgId = org.id;

  await identity.createUser({
    id: 'user-linked',
    organisationId: org.id,
    email: 'linked@example.com',
    displayName: 'Linked User',
    scopes: ['identity:read'],
    oidcIssuer: ISSUER,
    oidcSubject: 'sub-linked',
  });

  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.withPersistence({
        identity,
        audit,
        graph: graphRepo,
        submission: submissionRepo,
        underwriting: underwritingRepo,
        marketplace: marketplaceRepo,
        syndication: syndicationRepo,
        capital: capitalRepo,
        claims: claimsRepo,
        simulation: simulationRepo,
        reinsurance: reinsuranceRepo,
        settlement: settlementRepo,
        clock: new SystemClock(),
        extra: [{ provide: OidcVerifier, useValue: oidc }],
      }),
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>();
  hardenApp(app);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new SimulationNoticeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe('OIDC authentication', () => {
  it('accepts a validly-signed token for a user an admin linked, and resolves the org context', async () => {
    const token = await sign({ sub: 'sub-linked', email: 'linked@example.com' });
    const res = await request(http).get('/identity/organisations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects a token for a subject nobody has linked to a user', async () => {
    const token = await sign({ sub: 'sub-unknown' });
    const res = await request(http).get('/identity/organisations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await new SignJWT({ sub: 'sub-linked' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience('someone-else')
      .setExpirationTime('5m')
      .sign(privateKey);
    const res = await request(http).get('/identity/organisations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ sub: 'sub-linked' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('-1s')
      .sign(privateKey);
    const res = await request(http).get('/identity/organisations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('never returns a real organisation id in the error body for a rejected token', async () => {
    const token = await sign({ sub: 'sub-unknown' });
    const res = await request(http).get('/identity/organisations').set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(res.body)).not.toContain(orgId);
  });
});
