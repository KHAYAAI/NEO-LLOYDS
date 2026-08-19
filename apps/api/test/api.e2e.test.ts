import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter.js';
import { SimulationNoticeInterceptor } from '../src/common/simulation.interceptor.js';
import { hardenApp } from '../src/common/harden.js';
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
import { generateCredential, hashSecret } from '../src/common/auth.js';

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

/** Root credential, bootstrapped the way the seed script does. */
let rootToken: string;
let rootOrgId: string;

async function bootstrapOrganisation(
  legalName: string,
  scopes: string[],
  roles: string[],
): Promise<{ id: string; token: string }> {
  const org = await identity.createOrganisation({
    id: `org-${legalName.toLowerCase().replace(/\W+/g, '-')}`,
    legalName,
    kind: 'COMPANY',
    jurisdiction: 'ZA',
  });
  for (const role of roles) await identity.grantRole(org.id, role as never);

  const { keyId, secret, salt } = generateCredential();
  await identity.createCredential({
    id: `cred-${org.id}`,
    keyId,
    secretHash: hashSecret(secret, salt),
    secretSalt: salt,
    organisationId: org.id,
    label: 'test',
    scopes,
    subjectKind: 'SERVICE',
    expiresAt: null,
  });

  return { id: org.id, token: `${keyId}.${secret}` };
}

beforeAll(async () => {
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
      }),
    ],
  }).compile();

  process.env.CORS_ALLOWED_ORIGINS = 'https://allowed.test';

  app = moduleRef.createNestApplication<NestExpressApplication>();
  hardenApp(app);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new SimulationNoticeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.init();
  http = app.getHttpServer();

  const root = await bootstrapOrganisation('Neo-Lloyds Root', ['*'], [
    'RISK_ORIGINATOR',
    'BROKER',
    'UNDERWRITER',
    'CLAIMS_ADMINISTRATOR',
    'SYNDICATE',
  ]);
  rootOrgId = root.id;
  rootToken = root.token;
});

afterAll(async () => {
  await app?.close();
});

/** A request builder pre-authenticated as the root organisation. */
const authed = () => ({
  get: (url: string) =>
    request(http).get(url).set('Authorization', `Bearer ${rootToken}`),
  post: (url: string) =>
    request(http).post(url).set('Authorization', `Bearer ${rootToken}`),
});

function provenanceBody(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'test',
    sourceKind: 'USER_DECLARED',
    observedAt: '2026-08-01T00:00:00Z',
    confidence: 0.9,
    ...overrides,
  };
}

async function createNode(type: string, label: string, token = rootToken) {
  const response = await request(http)
    .post('/graph/nodes')
    .set('Authorization', `Bearer ${token}`)
    .send({ type, label, jurisdiction: 'ZA', provenance: provenanceBody() })
    .expect(201);
  return response.body.node.id as string;
}

function createEdge(type: string, fromId: string, toId: string) {
  return request(http)
    .post('/graph/edges')
    .set('Authorization', `Bearer ${rootToken}`)
    .send({ type, fromId, toId, provenance: provenanceBody() });
}

describe('public surface', () => {
  it('reports health without a credential', async () => {
    const response = await request(http).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.environment).toBe('SIMULATION');
  });

  it('stamps every response with the simulation notice', async () => {
    const response = await request(http).get('/health').expect(200);
    expect(response.body.notice).toContain('NOT INSURANCE');
  });

  it('publishes the ontology it actually validates against', async () => {
    const response = await request(http).get('/ontology').expect(200);
    expect(response.body.nodeTypes).toContain('SYNDICATE');
    expect(
      response.body.edgeRules.some(
        (r: { type: string; from: string; to: string }) =>
          r.type === 'ASSUMES' && r.from === 'SYNDICATE' && r.to === 'RISK',
      ),
    ).toBe(true);
  });

  it('publishes every configured jurisdiction module (ADR-0004)', async () => {
    const response = await request(http).get('/jurisdictions').expect(200);
    const codes = response.body.jurisdictions.map((j: { code: string }) => j.code);
    expect(new Set(codes)).toEqual(new Set(['ZA', 'GB', 'EU', 'US', 'RU', 'CN', 'SG', 'HK']));
    expect(response.body.supportedCodes[0]).toBe('ZA');
    for (const jurisdiction of response.body.jurisdictions) {
      expect(jurisdiction.disclaimer).toContain('not legal advice');
    }
  });

  it('retrieves a single jurisdiction module by code', async () => {
    const response = await request(http).get('/jurisdictions/ZA').expect(200);
    expect(response.body.name).toBe('South Africa');
    expect(response.body.regulator.name).toContain('FSCA');
  });

  it('returns 404 for an unconfigured jurisdiction code', async () => {
    await request(http).get('/jurisdictions/XX').expect(404);
  });
});

describe('hardening (docs/security-model.md §9)', () => {
  it('sets standard security headers on every response, including public routes', async () => {
    const response = await request(http).get('/health').expect(200);
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS from an explicitly allow-listed origin', async () => {
    const response = await request(http)
      .get('/health')
      .set('Origin', 'https://allowed.test')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.test');
  });

  it('does not grant CORS to an origin that was never allow-listed', async () => {
    const response = await request(http)
      .get('/health')
      .set('Origin', 'https://not-allowed.test')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a request body over the configured size limit', async () => {
    const oversized = 'x'.repeat(300 * 1024); // 300KB against a 256KB cap
    const response = await authed()
      .post('/graph/nodes')
      .send({
        type: 'ASSET',
        label: 'x',
        jurisdiction: 'ZA',
        provenance: provenanceBody(),
        attributes: { note: oversized },
      });
    expect(response.status).toBe(413);
  });
});

describe('authentication', () => {
  it('refuses an unauthenticated write', async () => {
    await request(http).post('/graph/nodes').send({}).expect(401);
  });

  it('refuses a malformed credential', async () => {
    await request(http)
      .get('/graph/subgraph')
      .set('Authorization', 'Bearer nonsense')
      .expect(401);
  });

  it('refuses a wrong secret for a real key', async () => {
    const keyId = rootToken.split('.')[0];
    await request(http)
      .get('/graph/subgraph')
      .set('Authorization', `Bearer ${keyId}.wrong`)
      .expect(401);
  });

  it('refuses a revoked credential immediately', async () => {
    const revocable = await bootstrapOrganisation('Revocable Ltd', ['graph:read'], []);
    await request(http)
      .get('/graph/subgraph')
      .set('Authorization', `Bearer ${revocable.token}`)
      .expect(200);

    await identity.revokeCredential(revocable.token.split('.')[0] as string);

    await request(http)
      .get('/graph/subgraph')
      .set('Authorization', `Bearer ${revocable.token}`)
      .expect(401);
  });
});

describe('authorisation', () => {
  it('refuses a caller lacking the scope', async () => {
    const limited = await bootstrapOrganisation('Read Only Ltd', ['graph:read'], [
      'BROKER',
    ]);
    await request(http)
      .post('/graph/nodes')
      .set('Authorization', `Bearer ${limited.token}`)
      .send({ type: 'ASSET', label: 'x', jurisdiction: 'ZA', provenance: provenanceBody() })
      .expect(403);
  });

  it('refuses a caller whose organisation lacks the market role', async () => {
    const noRole = await bootstrapOrganisation('No Role Ltd', ['graph:write'], []);
    await request(http)
      .post('/graph/nodes')
      .set('Authorization', `Bearer ${noRole.token}`)
      .send({ type: 'ASSET', label: 'x', jurisdiction: 'ZA', provenance: provenanceBody() })
      .expect(403);
  });

  it('isolates tenants', async () => {
    const other = await bootstrapOrganisation('Other Ltd', ['graph:read'], ['BROKER']);
    const nodeId = await createNode('ASSET', 'private asset');

    await request(http)
      .get(`/graph/assets/${nodeId}/dependencies`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(403);
  });
});

describe('graph writes enforce the ontology', () => {
  it('rejects an unknown node type', async () => {
    await authed()
      .post('/graph/nodes')
      .send({
        type: 'NOT_A_TYPE',
        label: 'x',
        jurisdiction: 'ZA',
        provenance: provenanceBody(),
      })
      .expect(422);
  });

  it('rejects an edge the ontology does not permit', async () => {
    const asset = await createNode('ASSET', 'a');
    const entity = await createNode('ENTITY', 'e');
    const response = await createEdge('OWNS', asset, entity);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_EDGE');
  });

  it('rejects a dependency cycle', async () => {
    const a = await createNode('ASSET', 'cycle-a');
    const b = await createNode('ASSET', 'cycle-b');
    await createEdge('DEPENDS_ON', a, b).expect(201);

    const response = await createEdge('DEPENDS_ON', b, a);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('DEPENDENCY_CYCLE');
  });

  it('rejects AI-inferred provenance with no model identity', async () => {
    const response = await authed()
      .post('/graph/nodes')
      .send({
        type: 'RISK',
        label: 'inferred risk',
        jurisdiction: 'ZA',
        provenance: provenanceBody({ sourceKind: 'AI_INFERRED' }),
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_PROVENANCE');
  });

  it('accepts AI-inferred provenance that cites its model and sources', async () => {
    await authed()
      .post('/graph/nodes')
      .send({
        type: 'RISK',
        label: 'inferred risk',
        jurisdiction: 'ZA',
        provenance: provenanceBody({
          sourceKind: 'AI_INFERRED',
          modelId: 'risk-analyst',
          modelVersion: '0.1.0',
          referencedData: ['doc-1'],
        }),
      })
      .expect(201);
  });

  it('rejects an unknown field rather than silently ignoring it', async () => {
    await authed()
      .post('/graph/nodes')
      .send({
        type: 'ASSET',
        label: 'x',
        jurisdiction: 'ZA',
        provenance: provenanceBody(),
        riskScore: 0.99,
      })
      .expect(400);
  });
});

describe('the MVP shipment scenario', () => {
  it('answers the risk-graph questions end to end', async () => {
    const shipper = await createNode('ENTITY', 'Kalahari Logistics');
    const shipment = await createNode('ASSET', 'Shipment KL-8842');
    const vessel = await createNode('ASSET', 'MV Agulhas');
    const port = await createNode('ASSET', 'Port of Durban');
    const risk = await createNode('RISK', 'Port closure > 72h');
    const event = await createNode('EVENT', 'Durban closed 96h');
    const loss = await createNode('LOSS', 'Cargo spoilage');
    const policy = await createNode('POLICY', 'Marine cargo cover');
    const syndicate = await createNode('SYNDICATE', 'Syndicate Alpha');
    const capital = await createNode('CAPITAL', 'Fund I commitment');

    await createEdge('OWNS', shipper, shipment).expect(201);
    await createEdge('DEPENDS_ON', shipment, vessel).expect(201);
    await createEdge('DEPENDS_ON', vessel, port).expect(201);
    await createEdge('EXPOSED_TO', port, risk).expect(201);
    await createEdge('MAY_CAUSE', risk, event).expect(201);
    await createEdge('MAY_CAUSE', event, loss).expect(201);
    await createEdge('COVERS', policy, risk).expect(201);
    await createEdge('ASSUMES', syndicate, risk).expect(201);
    await createEdge('SUPPORTS', capital, syndicate).expect(201);

    const canFail = await authed()
      .get(`/graph/entities/${shipper}/what-can-fail`)
      .expect(200);
    expect(canFail.body.assets.map((a: { id: string }) => a.id).sort()).toEqual(
      [shipment, vessel, port].sort(),
    );

    const deps = await authed().get(`/graph/assets/${port}/dependencies`).expect(200);
    expect(deps.body.dependents.map((d: { node: { id: string } }) => d.node.id)).toContain(
      shipment,
    );

    const picture = await authed().get(`/graph/risks/${risk}/picture`).expect(200);
    expect(picture.body.exposedEntities.map((e: { id: string }) => e.id)).toContain(
      shipper,
    );
    expect(picture.body.potentialLosses).toHaveLength(1);
    expect(picture.body.coveringPolicies.map((p: { id: string }) => p.id)).toEqual([policy]);
    expect(picture.body.capitalBearing[0].syndicate.id).toBe(syndicate);
    expect(picture.body.capitalBearing[0].capital.map((c: { id: string }) => c.id)).toEqual([
      capital,
    ]);
  });
});

describe('Phase 8: Simulation & Digital Twin', () => {
  async function buildFixtureGraph() {
    const shipper = await createNode('ENTITY', 'Kalahari Logistics');
    const shipment = await createNode('ASSET', 'Shipment KL-9001');
    const vessel = await createNode('ASSET', 'MV Tugela');
    const port = await createNode('ASSET', 'Port of Richards Bay');
    const risk = await createNode('RISK', 'Port closure > 72h (sim)');
    const policy = await createNode('POLICY', 'Marine cargo cover (sim)');
    const syndicate = await createNode('SYNDICATE', 'Syndicate Beta');
    const capital = await createNode('CAPITAL', 'Fund II commitment');

    await createEdge('OWNS', shipper, shipment).expect(201);
    await createEdge('DEPENDS_ON', shipment, vessel).expect(201);
    await createEdge('DEPENDS_ON', vessel, port).expect(201);
    await createEdge('EXPOSED_TO', port, risk).expect(201);
    await createEdge('COVERS', policy, risk).expect(201);
    await createEdge('ASSUMES', syndicate, risk).expect(201);
    await createEdge('SUPPORTS', capital, syndicate).expect(201);

    return { shipper, shipment, vessel, port, risk, policy, syndicate, capital };
  }

  it('runs a scenario forward from the graph and persists the result', async () => {
    const { shipper, shipment, vessel, port, syndicate } = await buildFixtureGraph();

    const response = await authed()
      .post('/simulation')
      .send({
        kind: 'PORT_CLOSURE',
        triggerNodeId: port,
        durationDays: 3,
        severity: 0.7,
        description: 'e2e port closure',
        currency: 'ZAR',
      })
      .expect(201);

    const run = response.body.simulationRun;
    expect(run.id).toBeTruthy();
    const result = run.result;
    expect(result.affectedAssets.map((a: { id: string }) => a.id).sort()).toEqual(
      [shipment, vessel].sort(),
    );
    expect(result.exposedEntities.map((e: { id: string }) => e.id)).toContain(shipper);
    expect(result.estimatedLoss.confidence).toBeLessThanOrEqual(0.2);
    expect(result.estimatedLoss.basis).toBe('INSUFFICIENT_DATA');
    expect(result.capitalRequirement.map((c: { syndicate: { id: string } }) => c.syndicate.id)).toEqual([
      syndicate,
    ]);
    expect(result.insuredVsUninsured.insuredEntities.map((e: { id: string }) => e.id)).toContain(
      shipper,
    );
  });

  it('exercises every scenario kind without error', async () => {
    const { port } = await buildFixtureGraph();
    const kinds = [
      'PORT_CLOSURE',
      'SUPPLY_CHAIN_DISRUPTION',
      'COMMODITY_SHOCK',
      'WEATHER',
      'INFRASTRUCTURE_FAILURE',
      'COUNTERPARTY_FAILURE',
      'GEOPOLITICAL',
      'CYBER',
    ];
    for (const kind of kinds) {
      await authed()
        .post('/simulation')
        .send({ kind, triggerNodeId: port, durationDays: 5, severity: 0.5, currency: 'ZAR' })
        .expect(201);
    }
  });

  it('retrieves a persisted simulation run by id', async () => {
    const { port } = await buildFixtureGraph();
    const created = await authed()
      .post('/simulation')
      .send({ kind: 'CYBER', triggerNodeId: port, durationDays: 1, severity: 0.3, currency: 'ZAR' })
      .expect(201);

    const fetched = await authed()
      .get(`/simulation/${created.body.simulationRun.id}`)
      .expect(200);
    expect(fetched.body.simulationRun.id).toBe(created.body.simulationRun.id);
  });

  it('lists simulation runs for the organisation', async () => {
    const { port } = await buildFixtureGraph();
    await authed()
      .post('/simulation')
      .send({ kind: 'WEATHER', triggerNodeId: port, durationDays: 2, severity: 0.4, currency: 'ZAR' })
      .expect(201);

    const list = await authed().get('/simulation').expect(200);
    expect(Array.isArray(list.body.simulationRuns)).toBe(true);
    expect(list.body.simulationRuns.length).toBeGreaterThan(0);
  });

  it('rejects an unknown scenario kind at the validation layer', async () => {
    const { port } = await buildFixtureGraph();
    await authed()
      .post('/simulation')
      .send({ kind: 'METEOR_STRIKE', triggerNodeId: port, durationDays: 2, severity: 0.4, currency: 'ZAR' })
      .expect(400);
  });

  it('rejects a severity outside [0,1] at the validation layer', async () => {
    const { port } = await buildFixtureGraph();
    await authed()
      .post('/simulation')
      .send({ kind: 'WEATHER', triggerNodeId: port, durationDays: 2, severity: 4, currency: 'ZAR' })
      .expect(400);
  });

  it('requires a credential', async () => {
    await request(http).post('/simulation').send({}).expect(401);
  });

  it('rejects an unknown trigger node with 404', async () => {
    await authed()
      .post('/simulation')
      .send({
        kind: 'WEATHER',
        triggerNodeId: 'does-not-exist',
        durationDays: 2,
        severity: 0.4,
        currency: 'ZAR',
      })
      .expect(404);
  });
});

describe('identity and governance', () => {
  it('still registers an organisation in an unconfigured jurisdiction, but flags the gap in the audit trail', async () => {
    const response = await authed()
      .post('/identity/organisations')
      .send({ legalName: 'No Module Yet Ltd', kind: 'COMPANY', jurisdiction: 'BR' }) // Brazil: no jurisdiction module configured
      .expect(201);
    expect(response.body.organisation.jurisdiction).toBe('BR');

    const record = audit.records.at(-1);
    expect(record?.action).toBe('identity.organisation.create');
    expect(record?.reason).toContain('no configured jurisdiction module');
  });

  it('refuses an agent organisation with no principal', async () => {
    const response = await authed()
      .post('/identity/organisations')
      .send({ legalName: 'Rogue Agent', kind: 'AI_AGENT', jurisdiction: 'ZA' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('AGENT_REQUIRES_PRINCIPAL');
  });

  it('refuses an agent acting as principal for another agent', async () => {
    const agent = await authed()
      .post('/identity/organisations')
      .send({
        legalName: 'Procurement Agent',
        kind: 'AI_AGENT',
        jurisdiction: 'ZA',
        principalOrganisationId: rootOrgId,
      })
      .expect(201);

    const response = await authed()
      .post('/identity/organisations')
      .send({
        legalName: 'Sub Agent',
        kind: 'AI_AGENT',
        jurisdiction: 'ZA',
        principalOrganisationId: agent.body.organisation.id,
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('AGENT_CHAIN_FORBIDDEN');
  });

  it('refuses a jurisdiction-less organisation: there is no default', async () => {
    await authed()
      .post('/identity/organisations')
      .send({ legalName: 'Nowhere Ltd', kind: 'COMPANY' })
      .expect(400);
  });

  it('returns a credential secret once, and never stores it in the clear', async () => {
    const response = await authed()
      .post(`/identity/organisations/${rootOrgId}/credentials`)
      .send({ label: 'integration', scopes: ['graph:read'] })
      .expect(201);

    const { keyId, secret } = response.body.credential;
    const stored = await identity.findCredentialByKeyId(keyId);
    expect(stored?.secretHash).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it('runs the configured (null) compliance providers and records the result, without touching kybStatus', async () => {
    const before = await authed().get(`/identity/organisations/${rootOrgId}`).expect(200);
    expect(before.body.organisation.kybStatus).toBe('UNVERIFIED');

    const response = await authed()
      .post(`/identity/organisations/${rootOrgId}/compliance/check`)
      .expect(201);

    expect(response.body.kyb).toEqual({
      providerId: 'null-provider',
      verdict: 'NOT_INTEGRATED',
      checkedAt: expect.any(String),
    });
    expect(response.body.sanctions).toEqual({
      providerId: 'null-provider',
      screened: false,
      hits: [],
      screenedAt: expect.any(String),
    });

    // The check is informational only -- setKybStatus is the only thing
    // that ever changes kybStatus, and this endpoint never calls it.
    const after = await authed().get(`/identity/organisations/${rootOrgId}`).expect(200);
    expect(after.body.organisation.kybStatus).toBe('UNVERIFIED');

    const record = audit.records.at(-1);
    expect(record?.action).toBe('identity.compliance.check');
    expect(record?.reason).toContain('NOT_INTEGRATED');
  });

  it('writes an audit record for every material action', async () => {
    const before = audit.records.length;
    await authed()
      .post('/identity/organisations')
      .send({ legalName: 'Audited Ltd', kind: 'COMPANY', jurisdiction: 'ZA' })
      .expect(201);

    expect(audit.records.length).toBe(before + 1);
    const record = audit.records.at(-1);
    expect(record?.action).toBe('identity.organisation.create');
    expect(record?.actorOrganisationId).toBe(rootOrgId);
    expect(record?.ontologyVersion).toBe('1.0.0');
  });

  it('keeps the credential secret out of the audit trail', async () => {
    const response = await authed()
      .post(`/identity/organisations/${rootOrgId}/credentials`)
      .send({ label: 'secret-check', scopes: ['graph:read'] })
      .expect(201);

    const secret = response.body.credential.secret as string;
    expect(JSON.stringify(audit.records)).not.toContain(secret);
  });

  it('exposes the audit log to a scoped caller, newest first', async () => {
    const response = await authed().get('/identity/audit?limit=5').expect(200);
    expect(response.body.records.length).toBeGreaterThan(0);
    expect(response.body.records[0].actorOrganisationId).toBe(rootOrgId);
  });
});

describe('Phase 2: deterministic scoring', () => {
  it('scores a risk reproducibly and with explicit confidence', async () => {
    const risk = await createNode('RISK', 'scoring-risk');
    const body = {
      factors: [
        {
          key: 'f1',
          description: 'test factor',
          weight: 1,
          likelihood: 0.3,
          confidence: 0.8,
          basis: 'STATISTICAL_MODEL',
        },
      ],
      maximumEstimatedLossMinor: 1_000_000_00,
      currency: 'USD',
      durationDays: 30,
      mitigationCoverage: 0.1,
      correlatedRiskCount: 1,
      concentrationShare: 0.05,
    };

    const first = await authed().post(`/scoring/risks/${risk}`).send(body).expect(201);
    const second = await authed().post(`/scoring/risks/${risk}`).send(body).expect(201);

    expect(first.body.score.probability.confidence).toBe(0.8);
    expect(first.body.score.expectedLoss.expected.amountMinor).toBe(
      second.body.score.expectedLoss.expected.amountMinor,
    );
  });

  it('returns INSUFFICIENT_DATA rather than a guess with no factors', async () => {
    const risk = await createNode('RISK', 'no-factor-risk');
    const response = await authed()
      .post(`/scoring/risks/${risk}`)
      .send({
        factors: [],
        maximumEstimatedLossMinor: 100_00,
        currency: 'USD',
        durationDays: 1,
        mitigationCoverage: 0,
        correlatedRiskCount: 0,
        concentrationShare: 0,
      })
      .expect(201);
    expect(response.body.score.probability.basis).toBe('INSUFFICIENT_DATA');
  });

  it('rejects a weight outside [0,1] with a domain error, not a silent clamp', async () => {
    const risk = await createNode('RISK', 'bad-weight-risk');
    const response = await authed()
      .post(`/scoring/risks/${risk}`)
      .send({
        factors: [
          {
            key: 'f1',
            description: 'x',
            weight: 1.5,
            likelihood: 0.5,
            confidence: 0.5,
            basis: 'OBSERVED',
          },
        ],
        maximumEstimatedLossMinor: 100_00,
        currency: 'USD',
        durationDays: 1,
        mitigationCoverage: 0,
        correlatedRiskCount: 0,
        concentrationShare: 0,
      });
    expect(response.status).toBe(400);
  });
});

describe('Phase 2: AI analyst is advisory and grounded', () => {
  it('degrades to a MISSING_INFORMATION finding with no provider configured', async () => {
    const risk = await createNode('RISK', 'analysed-risk');
    const response = await authed().get(`/analyst/risks/${risk}`).expect(200);

    expect(response.body.findings.length).toBeGreaterThan(0);
    for (const finding of response.body.findings) {
      expect(finding.modelId).toBeTruthy();
      expect(finding.modelVersion).toBeTruthy();
      expect(finding.referencedData.length).toBeGreaterThan(0);
    }
  });

  it('404s for a risk that does not exist', async () => {
    await authed().get('/analyst/risks/does-not-exist').expect(404);
  });
});

describe('Phase 2: risk submission workflow', () => {
  it('only allows forward transitions through the state machine', async () => {
    const risk = await createNode('RISK', 'submission-risk');
    const created = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: 'Test submission' })
      .expect(201);
    const id = created.body.submission.id as string;
    expect(created.body.submission.status).toBe('DRAFT');

    await authed().post(`/submissions/${id}/advance`).send({ to: 'SUBMITTED' }).expect(201);
    await authed().post(`/submissions/${id}/advance`).send({ to: 'ANALYSING' }).expect(201);

    const skip = await authed()
      .post(`/submissions/${id}/advance`)
      .send({ to: 'READY_FOR_UNDERWRITING' });
    expect(skip.status).toBe(422);
    expect(skip.body.error.code).toBe('INVALID_SUBMISSION_TRANSITION');

    const backward = await authed()
      .post(`/submissions/${id}/advance`)
      .send({ to: 'DRAFT' });
    expect(backward.status).toBe(422);
  });

  it('isolates submissions by tenant', async () => {
    const risk = await createNode('RISK', 'tenant-submission-risk');
    const created = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: 'Private' })
      .expect(201);

    const other = await bootstrapOrganisation('Submission Outsider', ['submission:read'], []);
    await request(http)
      .get(`/submissions/${created.body.submission.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(403);
  });
});

describe('Phase 3: underwriting assessment and approval gate', () => {
  function assessBody(overrides: Record<string, unknown> = {}) {
    return {
      factors: [
        {
          key: 'f1',
          description: 'test factor',
          weight: 1,
          likelihood: 0.01,
          confidence: 0.95,
          basis: 'STATISTICAL_MODEL',
        },
      ],
      maximumEstimatedLossMinor: 1_000_000_00,
      currency: 'USD',
      durationDays: 14,
      mitigationCoverage: 0,
      correlatedRiskCount: 0,
      concentrationShare: 0,
      ...overrides,
    };
  }

  it('a LOW-band assessment clears with no approval recorded', async () => {
    const risk = await createNode('RISK', 'low-band-risk');
    const assessed = await authed()
      .post(`/underwriting/risks/${risk}/assess`)
      .send(assessBody())
      .expect(201);

    expect(assessed.body.assessment.band).toBe('LOW');
    expect(assessed.body.assessment.requiresHumanApproval).toBe(false);

    await authed().get(`/underwriting/risks/${risk}/clearance`).expect(200);
  });

  it('a HIGH-band assessment blocks clearance until an underwriter approves', async () => {
    const risk = await createNode('RISK', 'high-band-risk');
    const assessed = await authed()
      .post(`/underwriting/risks/${risk}/assess`)
      .send(assessBody({ factors: [{ key: 'f1', description: 'd', weight: 1, likelihood: 0.3, confidence: 0.9, basis: 'STATISTICAL_MODEL' }] }))
      .expect(201);
    expect(assessed.body.assessment.requiresHumanApproval).toBe(true);

    const blocked = await authed().get(`/underwriting/risks/${risk}/clearance`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('APPROVAL_REQUIRED');

    await authed()
      .post(`/underwriting/risks/${risk}/approve`)
      .send({ decision: 'APPROVED', reason: 'Reviewed and acceptable.' })
      .expect(201);

    await authed().get(`/underwriting/risks/${risk}/clearance`).expect(200);
  });

  it('a rejected decision keeps the risk blocked', async () => {
    const risk = await createNode('RISK', 'rejected-risk');
    await authed()
      .post(`/underwriting/risks/${risk}/assess`)
      .send(assessBody({ factors: [{ key: 'f1', description: 'd', weight: 1, likelihood: 0.3, confidence: 0.9, basis: 'STATISTICAL_MODEL' }] }))
      .expect(201);

    await authed()
      .post(`/underwriting/risks/${risk}/approve`)
      .send({ decision: 'REJECTED', reason: 'Too concentrated.' })
      .expect(201);

    const blocked = await authed().get(`/underwriting/risks/${risk}/clearance`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('NOT_APPROVED');
  });

  it('only an UNDERWRITER may approve', async () => {
    const risk = await createNode('RISK', 'no-underwriter-role-risk');
    await authed().post(`/underwriting/risks/${risk}/assess`).send(assessBody()).expect(201);

    const broker = await bootstrapOrganisation('Broker Only Ltd', ['underwriting:approve'], [
      'BROKER',
    ]);
    const response = await request(http)
      .post(`/underwriting/risks/${risk}/approve`)
      .set('Authorization', `Bearer ${broker.token}`)
      .send({ decision: 'APPROVED', reason: 'x' });
    expect(response.status).toBe(403);
  });

  it('marks a risk with no data as ineligible, not silently priced', async () => {
    const risk = await createNode('RISK', 'no-data-risk');
    const response = await authed()
      .post(`/underwriting/risks/${risk}/assess`)
      .send(assessBody({ factors: [] }))
      .expect(201);
    expect(response.body.assessment.eligible).toBe(false);
  });

  it('clearance 404s when no assessment has ever been recorded', async () => {
    const risk = await createNode('RISK', 'never-assessed-risk');
    const response = await authed().get(`/underwriting/risks/${risk}/clearance`);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('NOT_ASSESSED');
  });
});

describe('Phase 4: marketplace', () => {
  async function readySubmission(riskLabel: string) {
    const risk = await createNode('RISK', riskLabel);
    const submission = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: riskLabel })
      .then((r) => r.body.submission);

    await authed().post(`/underwriting/risks/${risk}/assess`).send({
      factors: [
        { key: 'f1', description: 'd', weight: 1, likelihood: 0.01, confidence: 0.95, basis: 'STATISTICAL_MODEL' },
      ],
      maximumEstimatedLossMinor: 10000,
      currency: 'USD',
      durationDays: 30,
      mitigationCoverage: 0,
      correlatedRiskCount: 0,
      concentrationShare: 0,
    });

    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await authed().post(`/submissions/${submission.id}/advance`).send({ to });
    }

    return { risk, submission };
  }

  it('lists a ready, cleared submission and rejects listing an unready one', async () => {
    const { submission } = await readySubmission('marketplace-listing-risk');
    const listed = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'MARINE_CARGO', capacityMinor: 5000, currency: 'USD', durationDays: 30 })
      .expect(201);
    expect(listed.body.listing.status).toBe('OPEN');

    const dup = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'MARINE_CARGO', capacityMinor: 5000, currency: 'USD', durationDays: 30 });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('ALREADY_LISTED');
  });

  it('refuses to list a submission whose risk lacks underwriting clearance', async () => {
    const risk = await createNode('RISK', 'unassessed-listing-risk');
    const submission = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: 'unassessed' })
      .then((r) => r.body.submission);
    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await authed().post(`/submissions/${submission.id}/advance`).send({ to });
    }

    const response = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'MARINE_CARGO', capacityMinor: 5000, currency: 'USD', durationDays: 30 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('NOT_ASSESSED');
  });

  it('a capital provider sets appetite, matches, expresses and withdraws interest', async () => {
    const { submission } = await readySubmission('appetite-match-risk');
    const listed = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'MARINE_CARGO', capacityMinor: 5000, currency: 'USD', durationDays: 30 })
      .expect(201);
    const listingId = listed.body.listing.id as string;

    const provider = await bootstrapOrganisation('Test Capital Provider', ['*'], ['CAPITAL_PROVIDER']);
    const providerAuth = () => ({
      get: (url: string) => request(http).get(url).set('Authorization', `Bearer ${provider.token}`),
      post: (url: string) => request(http).post(url).set('Authorization', `Bearer ${provider.token}`),
      delete: (url: string) => request(http).delete(url).set('Authorization', `Bearer ${provider.token}`),
    });

    await providerAuth()
      .post('/marketplace/appetite')
      .send({
        preferredRiskClasses: ['MARINE_CARGO'],
        maxExposureMinor: 1_000_000,
        currency: 'USD',
        preferredJurisdictions: ['ZA'],
        minimumReturnBps: 500,
        maxDurationDays: 60,
        riskTolerance: 'MODERATE',
        concentrationLimitBps: 10_000,
      })
      .expect(201);

    const matches = await providerAuth().get('/marketplace/appetite/matches').expect(200);
    expect(matches.body.matches.some((m: { listing: { id: string }; result: { matches: boolean } }) => m.listing.id === listingId && m.result.matches)).toBe(true);

    const interest = await providerAuth()
      .post(`/marketplace/listings/${listingId}/interest`)
      .send({ indicativeAmountMinor: 2000, currency: 'USD', note: 'Interested.' })
      .expect(201);
    expect(interest.body.interest.organisationId).toBe(provider.id);

    const listed2 = await authed().get(`/marketplace/listings/${listingId}/interest`).expect(200);
    expect(listed2.body.interests).toHaveLength(1);

    await providerAuth().delete(`/marketplace/listings/${listingId}/interest`).expect(200);
  });

  it('a non-capital-provider cannot set appetite or express interest', async () => {
    const broker = await bootstrapOrganisation('Marketplace Broker Only', ['*'], ['BROKER']);
    const response = await request(http)
      .post('/marketplace/appetite')
      .set('Authorization', `Bearer ${broker.token}`)
      .send({
        preferredRiskClasses: [],
        maxExposureMinor: 1000,
        currency: 'USD',
        preferredJurisdictions: [],
        minimumReturnBps: 100,
        maxDurationDays: 30,
        riskTolerance: 'CONSERVATIVE',
        concentrationLimitBps: 5000,
      });
    expect(response.status).toBe(403);
  });

  it('browsing listings never exposes a withdrawn listing', async () => {
    const { submission } = await readySubmission('withdrawn-listing-risk');
    const listed = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'UNIQUE_CLASS_XYZ', capacityMinor: 5000, currency: 'USD', durationDays: 30 })
      .expect(201);

    await authed().post(`/marketplace/listings/${listed.body.listing.id}/withdraw`).expect(201);

    const browsed = await authed().get('/marketplace/listings?riskClass=UNIQUE_CLASS_XYZ').expect(200);
    expect(browsed.body.listings).toHaveLength(0);
  });
});

describe('Phase 5: syndication', () => {
  async function openListing(riskLabel: string, capacityMinor = 10_000) {
    const risk = await createNode('RISK', riskLabel);
    const submission = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: riskLabel })
      .then((r) => r.body.submission);

    await authed().post(`/underwriting/risks/${risk}/assess`).send({
      factors: [
        { key: 'f1', description: 'd', weight: 1, likelihood: 0.01, confidence: 0.95, basis: 'STATISTICAL_MODEL' },
      ],
      maximumEstimatedLossMinor: 10000,
      currency: 'USD',
      durationDays: 30,
      mitigationCoverage: 0,
      correlatedRiskCount: 0,
      concentrationShare: 0,
    });
    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await authed().post(`/submissions/${submission.id}/advance`).send({ to });
    }

    const listing = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'SYNDICATION_TEST', capacityMinor, currency: 'USD', durationDays: 30 })
      .then((r) => r.body.listing);

    return listing.id as string;
  }

  async function capitalProvider(name: string, listingId: string, indicativeAmountMinor = 1000) {
    const provider = await bootstrapOrganisation(name, ['*'], ['CAPITAL_PROVIDER']);
    const authedAs = () => ({
      get: (url: string) => request(http).get(url).set('Authorization', `Bearer ${provider.token}`),
      post: (url: string) => request(http).post(url).set('Authorization', `Bearer ${provider.token}`),
      delete: (url: string) => request(http).delete(url).set('Authorization', `Bearer ${provider.token}`),
    });
    await authedAs()
      .post(`/marketplace/listings/${listingId}/interest`)
      .send({ indicativeAmountMinor, currency: 'USD' })
      .expect(201);
    // A Phase 6 precondition: a provider must have a committed capital
    // ceiling before it may propose any allocation. Generously sized here so
    // Phase 5's own tests (which predate the capital ledger) are unaffected
    // by it; the capital-ledger-specific tests below set tighter ceilings
    // deliberately to exercise INSUFFICIENT_COMMITTED_CAPITAL.
    await authedAs()
      .post('/capital/commitments')
      .send({ committedMinor: 100_000_000, currency: 'USD' })
      .expect(201);
    return { ...provider, authedAs };
  }

  it('opens exactly one syndication per listing', async () => {
    const listingId = await openListing('synd-single-open');
    await authed().post('/syndication').send({ listingId }).expect(201);

    const dup = await authed().post('/syndication').send({ listingId });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('ALREADY_SYNDICATED');
  });

  it('requires a live expression of interest before a provider may propose', async () => {
    const listingId = await openListing('synd-no-interest');
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);

    const outsider = await bootstrapOrganisation('No Interest Provider', ['*'], ['CAPITAL_PROVIDER']);
    const response = await request(http)
      .post(`/syndication/${syndication.id}/allocations`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ shareBps: 5000 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('NO_LIVE_INTEREST');
  });

  it('rejects duplicate capacity: the same provider proposing twice', async () => {
    const listingId = await openListing('synd-duplicate');
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);
    const provider = await capitalProvider('Dup Provider', listingId);

    await provider.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 3000 }).expect(201);
    const dup = await provider.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 2000 });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('DUPLICATE_ALLOCATION');
  });

  it('rejects over-allocation: proposals that would push the total past 100%', async () => {
    const listingId = await openListing('synd-over-allocate');
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);
    const a = await capitalProvider('Over Alloc A', listingId);
    const b = await capitalProvider('Over Alloc B', listingId);

    await a.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 7000 }).expect(201);
    const over = await b.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 4000 });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('OVER_ALLOCATION');
  });

  it('rejects an allocation that would exceed the provider\'s declared exposure limit', async () => {
    const listingId = await openListing('synd-exposure-limit', 1_000_000_00);
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);
    const provider = await capitalProvider('Exposure Limited Provider', listingId, 100_00);

    await provider.authedAs().post('/marketplace/appetite').send({
      preferredRiskClasses: [],
      maxExposureMinor: 100_00, // $100 max exposure
      currency: 'USD',
      preferredJurisdictions: [],
      minimumReturnBps: 100,
      maxDurationDays: 60,
      riskTolerance: 'CONSERVATIVE',
      concentrationLimitBps: 10_000,
    }).expect(201);

    // 50% of $1,000,000 capacity is $500,000 — far above the $100 limit.
    const response = await provider.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 5000 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('EXPOSURE_LIMIT_EXCEEDED');
  });

  it('refuses to bind an incomplete syndication, and only the listing owner may bind', async () => {
    const listingId = await openListing('synd-incomplete-bind');
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);
    const provider = await capitalProvider('Incomplete Bind Provider', listingId);
    await provider.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 5000 }).expect(201);

    const incomplete = await authed().post(`/syndication/${syndication.id}/bind`);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe('INCOMPLETE_ALLOCATION');

    const wrongCaller = await provider.authedAs().post(`/syndication/${syndication.id}/bind`);
    expect(wrongCaller.status).toBe(403);
  });

  it('binds at exactly 100%, sums exactly to capacity, and freezes the syndication', async () => {
    const listingId = await openListing('synd-full-bind', 100_000); // deliberately awkward for a 3-way split
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);

    const a = await capitalProvider('Bind Provider A', listingId);
    const b = await capitalProvider('Bind Provider B', listingId);
    const c = await capitalProvider('Bind Provider C', listingId);
    await a.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 3334 }).expect(201);
    await b.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 3333 }).expect(201);
    await c.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 3333 }).expect(201);

    const bound = await authed().post(`/syndication/${syndication.id}/bind`).expect(201);
    expect(bound.body.syndication.status).toBe('BOUND');

    const allocations = await authed().get(`/syndication/${syndication.id}/allocations`).expect(200);
    const sum = allocations.body.allocations.reduce(
      (acc: number, a: { amount: { amountMinor: number } }) => acc + a.amount.amountMinor,
      0,
    );
    expect(sum).toBe(100_000);

    // The underlying listing is now MATCHED, not OPEN.
    const listing = await authed().get(`/marketplace/listings/${listingId}`).expect(200);
    expect(listing.body.listing.status).toBe('MATCHED');

    // Once bound, no further proposal, withdrawal, or duplicate bind is
    // possible. (The listing is MATCHED now, so a new provider cannot even
    // express interest — the marketplace layer blocks it before syndication
    // would; that is itself a correct downstream effect of binding.)
    const d = await bootstrapOrganisation('Bind Provider D', ['*'], ['CAPITAL_PROVIDER']);
    const interestAfterMatch = await request(http)
      .post(`/marketplace/listings/${listingId}/interest`)
      .set('Authorization', `Bearer ${d.token}`)
      .send({ indicativeAmountMinor: 1, currency: 'USD' });
    expect(interestAfterMatch.status).toBe(422);
    expect(interestAfterMatch.body.error.code).toBe('LISTING_NOT_OPEN');

    const afterBind = await request(http)
      .post(`/syndication/${syndication.id}/allocations`)
      .set('Authorization', `Bearer ${d.token}`)
      .send({ shareBps: 1 });
    expect(afterBind.status).toBe(422);
    expect(afterBind.body.error.code).toBe('SYNDICATION_NOT_OPEN');

    const rebind = await authed().post(`/syndication/${syndication.id}/bind`);
    expect(rebind.status).toBe(422);
    expect(rebind.body.error.code).toBe('SYNDICATION_NOT_OPEN');

    // The full history remains, including every propose event, and is
    // ordered and complete — this is the immutable allocation history.
    const events = await authed().get(`/syndication/${syndication.id}/events`).expect(200);
    const actions = events.body.events.map((e: { action: string }) => e.action);
    expect(actions.filter((a: string) => a === 'PROPOSED')).toHaveLength(3);
    expect(actions.filter((a: string) => a === 'BOUND')).toHaveLength(3);
  });

  it('allows freely withdrawing and reproposing before binding', async () => {
    const listingId = await openListing('synd-withdraw-repropose');
    const syndication = await authed().post('/syndication').send({ listingId }).then((r) => r.body.syndication);
    const provider = await capitalProvider('Withdraw Provider', listingId);

    await provider.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 4000 }).expect(201);
    await provider.authedAs().delete(`/syndication/${syndication.id}/allocations`).expect(200);

    const allocations = await authed().get(`/syndication/${syndication.id}/allocations`).expect(200);
    expect(allocations.body.allocations).toHaveLength(0);

    // Freed capacity can be reproposed without a duplicate-allocation error.
    await provider.authedAs().post(`/syndication/${syndication.id}/allocations`).send({ shareBps: 4000 }).expect(201);

    // The withdrawal is preserved in history even though the live row is gone.
    const events = await authed().get(`/syndication/${syndication.id}/events`).expect(200);
    const actions = events.body.events.map((e: { action: string }) => e.action);
    expect(actions).toContain('REMOVED');
  });
});

describe('Phase 6: capital ledger — cross-syndication exposure', () => {
  async function openListing(riskLabel: string, capacityMinor = 10_000) {
    const risk = await createNode('RISK', riskLabel);
    const submission = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: riskLabel })
      .then((r) => r.body.submission);

    await authed().post(`/underwriting/risks/${risk}/assess`).send({
      factors: [
        { key: 'f1', description: 'd', weight: 1, likelihood: 0.01, confidence: 0.95, basis: 'STATISTICAL_MODEL' },
      ],
      maximumEstimatedLossMinor: 10000,
      currency: 'USD',
      durationDays: 30,
      mitigationCoverage: 0,
      correlatedRiskCount: 0,
      concentrationShare: 0,
    });
    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await authed().post(`/submissions/${submission.id}/advance`).send({ to });
    }

    const listing = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'LEDGER_TEST', capacityMinor, currency: 'USD', durationDays: 30 })
      .then((r) => r.body.listing);

    const syndication = await authed()
      .post('/syndication')
      .send({ listingId: listing.id })
      .then((r) => r.body.syndication);

    return { listingId: listing.id as string, syndicationId: syndication.id as string };
  }

  function providerAuth(token: string) {
    return {
      get: (url: string) => request(http).get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string) => request(http).post(url).set('Authorization', `Bearer ${token}`),
    };
  }

  it('refuses a proposal from a provider with no committed capital at all', async () => {
    const { listingId, syndicationId } = await openListing('ledger-no-commitment');
    const provider = await bootstrapOrganisation('No Commitment Provider', ['*'], ['CAPITAL_PROVIDER']);
    await providerAuth(provider.token)
      .post(`/marketplace/listings/${listingId}/interest`)
      .send({ indicativeAmountMinor: 1000, currency: 'USD' })
      .expect(201);

    const response = await providerAuth(provider.token)
      .post(`/syndication/${syndicationId}/allocations`)
      .send({ shareBps: 5000 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('NO_CAPITAL_COMMITMENT');
  });

  it(
    "catches an over-extended provider ONLY via the cross-syndication check: two separate listings, each individually within the provider's per-listing appetite, but combined exceeding its total committed capital",
    async () => {
      const provider = await bootstrapOrganisation('Cross Syndication Provider', ['*'], [
        'CAPITAL_PROVIDER',
      ]);

      // Committed capital: $700. Two listings of $600 capacity each — a 50%
      // share of either one ($300) is comfortably within a per-listing
      // appetite ceiling of, say, $1,000. Nothing about either proposal in
      // isolation looks wrong.
      await providerAuth(provider.token)
        .post('/capital/commitments')
        .send({ committedMinor: 700, currency: 'USD' })
        .expect(201);
      await providerAuth(provider.token)
        .post('/marketplace/appetite')
        .send({
          preferredRiskClasses: [],
          maxExposureMinor: 1000,
          currency: 'USD',
          preferredJurisdictions: [],
          minimumReturnBps: 100,
          maxDurationDays: 60,
          riskTolerance: 'MODERATE',
          concentrationLimitBps: 10_000,
        })
        .expect(201);

      const listingA = await openListing('ledger-cross-a', 600);
      const listingB = await openListing('ledger-cross-b', 600);

      await providerAuth(provider.token)
        .post(`/marketplace/listings/${listingA.listingId}/interest`)
        .send({ indicativeAmountMinor: 300, currency: 'USD' })
        .expect(201);
      await providerAuth(provider.token)
        .post(`/marketplace/listings/${listingB.listingId}/interest`)
        .send({ indicativeAmountMinor: 300, currency: 'USD' })
        .expect(201);

      // First proposal: $300 of $700 committed. Passes every check,
      // including the per-listing exposure check (well under $1,000).
      await providerAuth(provider.token)
        .post(`/syndication/${listingA.syndicationId}/allocations`)
        .send({ shareBps: 5000 })
        .expect(201);

      // Second proposal, on a *different* listing: also $300, also well
      // under the $1,000 per-listing appetite ceiling — that check alone
      // would pass it. But $300 + $300 = $600, safely under $700... until
      // the platform-wide picture also includes reserved capacity properly.
      // Push it to $500 on listing B specifically to force the total past
      // the $700 ceiling ($300 + $500 = $800), which no single listing's
      // view can see.
      const overExtended = await providerAuth(provider.token)
        .post(`/syndication/${listingB.syndicationId}/allocations`)
        .send({ shareBps: 8334 }); // 83.34% of $600 = $500.04 -> $500
      expect(overExtended.status).toBe(422);
      expect(overExtended.body.error.code).toBe('INSUFFICIENT_COMMITTED_CAPITAL');
      expect(overExtended.body.error.details.available).toEqual({ amountMinor: 400, currency: 'USD' });
    },
  );

  it('reports a live position summing allocated (BOUND) and reserved (OPEN) across syndications', async () => {
    const provider = await bootstrapOrganisation('Position Provider', ['*'], ['CAPITAL_PROVIDER']);
    await providerAuth(provider.token)
      .post('/capital/commitments')
      .send({ committedMinor: 10_000, currency: 'USD' })
      .expect(201);

    const bound = await openListing('ledger-position-bound', 4_000);
    const open = await openListing('ledger-position-open', 3_000);

    for (const listingId of [bound.listingId, open.listingId]) {
      await providerAuth(provider.token)
        .post(`/marketplace/listings/${listingId}/interest`)
        .send({ indicativeAmountMinor: 1000, currency: 'USD' })
        .expect(201);
    }

    await providerAuth(provider.token)
      .post(`/syndication/${bound.syndicationId}/allocations`)
      .send({ shareBps: 10_000 })
      .expect(201);
    await authed().post(`/syndication/${bound.syndicationId}/bind`).expect(201);

    await providerAuth(provider.token)
      .post(`/syndication/${open.syndicationId}/allocations`)
      .send({ shareBps: 5000 })
      .expect(201);

    const position = await providerAuth(provider.token).get('/capital/exposure').expect(200);
    expect(position.body.position.allocated.amountMinor).toBe(4_000); // BOUND
    expect(position.body.position.reserved.amountMinor).toBe(1_500); // OPEN: 50% of 3,000
    expect(position.body.position.available.amountMinor).toBe(4_500); // 10,000 - 4,000 - 1,500
  });

  it('reports concentration by risk class across every syndication the provider holds', async () => {
    const provider = await bootstrapOrganisation('Concentration Provider', ['*'], ['CAPITAL_PROVIDER']);
    await providerAuth(provider.token)
      .post('/capital/commitments')
      .send({ committedMinor: 100_000, currency: 'USD' })
      .expect(201);

    const a = await openListing('ledger-concentration-a', 6_000);
    const b = await openListing('ledger-concentration-b', 4_000);

    for (const listingId of [a.listingId, b.listingId]) {
      await providerAuth(provider.token)
        .post(`/marketplace/listings/${listingId}/interest`)
        .send({ indicativeAmountMinor: 1000, currency: 'USD' })
        .expect(201);
    }
    await providerAuth(provider.token)
      .post(`/syndication/${a.syndicationId}/allocations`)
      .send({ shareBps: 10_000 })
      .expect(201);
    await providerAuth(provider.token)
      .post(`/syndication/${b.syndicationId}/allocations`)
      .send({ shareBps: 10_000 })
      .expect(201);

    const concentration = await providerAuth(provider.token)
      .get('/capital/concentration?by=riskClass')
      .expect(200);
    const total = concentration.body.buckets.reduce(
      (acc: number, bucket: { amount: { amountMinor: number } }) => acc + bucket.amount.amountMinor,
      0,
    );
    expect(total).toBe(10_000);
    expect(concentration.body.buckets.every((b: { shareBps: number }) => b.shareBps === 10_000)).toBe(true);
  });
});

describe('Phase 7: claims — testing a bound allocation against a loss', () => {
  function providerAuth(token: string) {
    return {
      get: (url: string) => request(http).get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string) => request(http).post(url).set('Authorization', `Bearer ${token}`),
    };
  }

  /** Opens, syndicates, and fully binds a listing with a single 100% provider. */
  async function boundSyndication(riskLabel: string, capacityMinor = 100_000) {
    const risk = await createNode('RISK', riskLabel);
    const submission = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: riskLabel })
      .then((r) => r.body.submission);

    await authed().post(`/underwriting/risks/${risk}/assess`).send({
      factors: [
        { key: 'f1', description: 'd', weight: 1, likelihood: 0.01, confidence: 0.95, basis: 'STATISTICAL_MODEL' },
      ],
      maximumEstimatedLossMinor: 10000,
      currency: 'USD',
      durationDays: 30,
      mitigationCoverage: 0,
      correlatedRiskCount: 0,
      concentrationShare: 0,
    });
    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await authed().post(`/submissions/${submission.id}/advance`).send({ to });
    }

    const listing = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'CLAIMS_TEST', capacityMinor, currency: 'USD', durationDays: 30 })
      .then((r) => r.body.listing);

    const syndication = await authed()
      .post('/syndication')
      .send({ listingId: listing.id })
      .then((r) => r.body.syndication);

    const provider = await bootstrapOrganisation(`Claims Provider ${riskLabel}`, ['*'], ['CAPITAL_PROVIDER']);
    await providerAuth(provider.token)
      .post(`/marketplace/listings/${listing.id}/interest`)
      .send({ indicativeAmountMinor: capacityMinor, currency: 'USD' })
      .expect(201);
    await providerAuth(provider.token)
      .post('/capital/commitments')
      .send({ committedMinor: capacityMinor, currency: 'USD' })
      .expect(201);
    await providerAuth(provider.token)
      .post(`/syndication/${syndication.id}/allocations`)
      .send({ shareBps: 10_000 })
      .expect(201);
    await authed().post(`/syndication/${syndication.id}/bind`).expect(201);

    return { riskId: risk, syndicationId: syndication.id as string, provider };
  }

  it('refuses to confirm coverage against a syndication that is not BOUND', async () => {
    const risk = await createNode('RISK', 'claims-unbound-risk');
    const submission = await authed()
      .post('/submissions')
      .send({ riskId: risk, title: 'unbound' })
      .then((r) => r.body.submission);
    await authed().post(`/underwriting/risks/${risk}/assess`).send({
      factors: [{ key: 'f1', description: 'd', weight: 1, likelihood: 0.01, confidence: 0.95, basis: 'STATISTICAL_MODEL' }],
      maximumEstimatedLossMinor: 10000, currency: 'USD', durationDays: 30,
      mitigationCoverage: 0, correlatedRiskCount: 0, concentrationShare: 0,
    });
    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await authed().post(`/submissions/${submission.id}/advance`).send({ to });
    }
    const listing = await authed()
      .post('/marketplace/listings')
      .send({ submissionId: submission.id, riskClass: 'UNBOUND_TEST', capacityMinor: 10_000, currency: 'USD', durationDays: 30 })
      .then((r) => r.body.listing);
    const syndication = await authed().post('/syndication').send({ listingId: listing.id }).then((r) => r.body.syndication);

    const claim = await authed()
      .post('/claims')
      .send({ syndicationId: syndication.id, riskId: risk, incidentDescription: 'test incident' })
      .then((r) => r.body.claim);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'EVIDENCE_COLLECTED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'VERIFIED' }).expect(201);

    const response = await authed().post(`/claims/${claim.id}/advance`).send({ to: 'COVERAGE_CONFIRMED' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('SYNDICATION_NOT_BOUND');
  });

  it('a low-value claim is auto-approved and paid out exactly, with no human approval call', async () => {
    const { riskId, syndicationId, provider } = await boundSyndication('claims-auto', 100_000);

    const claim = await authed()
      .post('/claims')
      .send({ syndicationId, riskId, incidentDescription: 'Minor cargo damage.' })
      .then((r) => r.body.claim);

    await authed().post(`/claims/${claim.id}/evidence`).send({ evidenceRef: 'photo-1.jpg' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'EVIDENCE_COLLECTED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'VERIFIED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'COVERAGE_CONFIRMED' }).expect(201);

    const lossResult = await authed()
      .post(`/claims/${claim.id}/loss`)
      .send({ claimedLossMinor: 1000, currency: 'USD' })
      .expect(201);
    expect(lossResult.body.claim.reviewDecision).toBe('AUTO');
    expect(lossResult.body.claim.status).toBe('APPROVED');

    const payouts = await authed().get(`/claims/${claim.id}/payouts`).expect(200);
    expect(payouts.body.payouts).toEqual([
      { claimId: claim.id, organisationId: provider.id, amount: { amountMinor: 1000, currency: 'USD' } },
    ]);

    await authed().post(`/claims/${claim.id}/settle`).expect(201);
    const settled = await authed().get(`/claims/${claim.id}`).expect(200);
    expect(settled.body.claim.status).toBe('SETTLED');
  });

  it('a high-value claim requires human review and blocks approval without it', async () => {
    const { riskId, syndicationId } = await boundSyndication('claims-human-review', 100_000_00);

    const claim = await authed()
      .post('/claims')
      .send({ syndicationId, riskId, incidentDescription: 'Major loss.' })
      .then((r) => r.body.claim);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'EVIDENCE_COLLECTED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'VERIFIED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'COVERAGE_CONFIRMED' }).expect(201);

    const lossResult = await authed()
      .post(`/claims/${claim.id}/loss`)
      .send({ claimedLossMinor: 30_000_00, currency: 'USD' }) // above the $25,000 default threshold
      .expect(201);
    expect(lossResult.body.claim.reviewDecision).toBe('HUMAN_REVIEW');
    expect(lossResult.body.claim.status).toBe('AWAITING_APPROVAL');

    // No payout exists yet — nothing was approved.
    const beforeApproval = await authed().get(`/claims/${claim.id}/payouts`).expect(200);
    expect(beforeApproval.body.payouts).toHaveLength(0);

    // Settling before approval is impossible: SETTLED is not reachable from AWAITING_APPROVAL.
    const prematureSettle = await authed().post(`/claims/${claim.id}/settle`);
    expect(prematureSettle.status).toBe(422);
    expect(prematureSettle.body.error.code).toBe('INVALID_CLAIM_TRANSITION');

    await authed().post(`/claims/${claim.id}/decide`).send({ decision: 'APPROVED', reason: 'Evidence sufficient.' }).expect(201);

    const payouts = await authed().get(`/claims/${claim.id}/payouts`).expect(200);
    expect(payouts.body.payouts[0].amount.amountMinor).toBe(30_000_00);
  });

  it('a rejected claim never produces a payout and cannot be settled', async () => {
    const { riskId, syndicationId } = await boundSyndication('claims-rejected', 100_000_00);

    const claim = await authed()
      .post('/claims')
      .send({ syndicationId, riskId, incidentDescription: 'Disputed loss.' })
      .then((r) => r.body.claim);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'EVIDENCE_COLLECTED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'VERIFIED' }).expect(201);
    await authed().post(`/claims/${claim.id}/advance`).send({ to: 'COVERAGE_CONFIRMED' }).expect(201);
    await authed().post(`/claims/${claim.id}/loss`).send({ claimedLossMinor: 30_000_00, currency: 'USD' }).expect(201);

    await authed().post(`/claims/${claim.id}/decide`).send({ decision: 'REJECTED', reason: 'Not covered.' }).expect(201);

    const payouts = await authed().get(`/claims/${claim.id}/payouts`).expect(200);
    expect(payouts.body.payouts).toHaveLength(0);

    const settle = await authed().post(`/claims/${claim.id}/settle`);
    expect(settle.status).toBe(422);
  });

  it('enforces the running total: a second claim cannot exceed what remains after the first', async () => {
    const { riskId, syndicationId } = await boundSyndication('claims-running-total', 100_000_00);

    // First claim: $60,000 of $100,000 capacity, auto-approved is impossible
    // (above default threshold) so route through human approval.
    const first = await authed()
      .post('/claims')
      .send({ syndicationId, riskId, incidentDescription: 'First incident.' })
      .then((r) => r.body.claim);
    await authed().post(`/claims/${first.id}/advance`).send({ to: 'EVIDENCE_COLLECTED' }).expect(201);
    await authed().post(`/claims/${first.id}/advance`).send({ to: 'VERIFIED' }).expect(201);
    await authed().post(`/claims/${first.id}/advance`).send({ to: 'COVERAGE_CONFIRMED' }).expect(201);
    await authed().post(`/claims/${first.id}/loss`).send({ claimedLossMinor: 60_000_00, currency: 'USD' }).expect(201);
    await authed().post(`/claims/${first.id}/decide`).send({ decision: 'APPROVED', reason: 'Confirmed.' }).expect(201);

    // Second claim on the SAME syndication: only $40,000 remains ($100,000 -
    // $60,000). $45,000 is well within the syndication's total capacity in
    // isolation but exceeds what remains after the first claim.
    const second = await authed()
      .post('/claims')
      .send({ syndicationId, riskId, incidentDescription: 'Second incident.' })
      .then((r) => r.body.claim);
    await authed().post(`/claims/${second.id}/advance`).send({ to: 'EVIDENCE_COLLECTED' }).expect(201);
    await authed().post(`/claims/${second.id}/advance`).send({ to: 'VERIFIED' }).expect(201);
    await authed().post(`/claims/${second.id}/advance`).send({ to: 'COVERAGE_CONFIRMED' }).expect(201);

    const overRemaining = await authed()
      .post(`/claims/${second.id}/loss`)
      .send({ claimedLossMinor: 45_000_00, currency: 'USD' });
    expect(overRemaining.status).toBe(422);
    expect(overRemaining.body.error.code).toBe('LOSS_EXCEEDS_REMAINING_CAPACITY');
    expect(overRemaining.body.error.details.remaining).toEqual({ amountMinor: 40_000_00, currency: 'USD' });

    // Exactly the remaining $40,000 is accepted.
    const withinRemaining = await authed()
      .post(`/claims/${second.id}/loss`)
      .send({ claimedLossMinor: 40_000_00, currency: 'USD' });
    expect(withinRemaining.status).toBe(201);
  });
});

describe('Phase 9: Reinsurance', () => {
  it('creates a program with a quota-share and an excess-of-loss layer, stacked in order', async () => {
    const response = await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'Alpha Marine Program',
        currency: 'USD',
        layers: [
          { order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 2000 } },
          {
            order: 2,
            params: { kind: 'EXCESS_OF_LOSS', attachmentPointMinor: 100_000_00, limitMinor: 500_000_00 },
          },
        ],
      })
      .expect(201);

    const program = response.body.program;
    expect(program.id).toBeTruthy();
    expect(program.layers).toHaveLength(2);
    expect(program.layers[0].kind).toBe('QUOTA_SHARE');
    expect(program.layers[1].kind).toBe('EXCESS_OF_LOSS');
  });

  it('cedes a loss through the program layers and persists the cession', async () => {
    const created = await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'Cession Test Program',
        currency: 'USD',
        layers: [{ order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 3000 } }],
      })
      .expect(201);
    const programId = created.body.program.id;

    const cession = await authed()
      .post(`/reinsurance/programs/${programId}/cede`)
      .send({ grossLossMinor: 100_000_00, currency: 'USD' })
      .expect(201);

    expect(cession.body.cession.totalCeded).toEqual({ amountMinor: 30_000_00, currency: 'USD' });
    expect(cession.body.cession.netRetained).toEqual({ amountMinor: 70_000_00, currency: 'USD' });

    const fetched = await authed().get(`/reinsurance/programs/${programId}`).expect(200);
    expect(fetched.body.program.id).toBe(programId);

    const cessions = await authed().get(`/reinsurance/programs/${programId}/cessions`).expect(200);
    expect(cessions.body.cessions).toHaveLength(1);
  });

  it('carries aggregate layer state across multiple cessions on the same program', async () => {
    const created = await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'Aggregate Program',
        currency: 'USD',
        layers: [
          {
            order: 1,
            params: { kind: 'AGGREGATE', attachmentPointMinor: 1_000_00, limitMinor: 500_00 },
          },
        ],
      })
      .expect(201);
    const programId = created.body.program.id;

    // First cession: cumulative loss 600, stays below the 1,000 attachment — nothing ceded.
    const first = await authed()
      .post(`/reinsurance/programs/${programId}/cede`)
      .send({ grossLossMinor: 600_00, currency: 'USD' })
      .expect(201);
    expect(first.body.cession.totalCeded).toEqual({ amountMinor: 0, currency: 'USD' });

    // Second cession: cumulative goes 600 -> 1200, of which 200 is above the attachment.
    const second = await authed()
      .post(`/reinsurance/programs/${programId}/cede`)
      .send({ grossLossMinor: 600_00, currency: 'USD' })
      .expect(201);
    expect(second.body.cession.totalCeded).toEqual({ amountMinor: 200_00, currency: 'USD' });
  });

  it('links a cession to a claim id for audit purposes when provided', async () => {
    const created = await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'Claim-Linked Program',
        currency: 'USD',
        layers: [{ order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 1000 } }],
      })
      .expect(201);
    const programId = created.body.program.id;

    const cession = await authed()
      .post(`/reinsurance/programs/${programId}/cede`)
      .send({ grossLossMinor: 10_000_00, currency: 'USD', claimId: 'claim-fixture-id' })
      .expect(201);
    expect(cession.body.cession.claimId).toBe('claim-fixture-id');
  });

  it('lists programs for the organisation', async () => {
    await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'Listable Program',
        currency: 'USD',
        layers: [{ order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 1000 } }],
      })
      .expect(201);

    const list = await authed().get('/reinsurance/programs').expect(200);
    expect(Array.isArray(list.body.programs)).toBe(true);
    expect(list.body.programs.length).toBeGreaterThan(0);
  });

  it('rejects an unknown layer kind at the validation layer', async () => {
    await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'Bad Program',
        currency: 'USD',
        layers: [{ order: 1, params: { kind: 'SIDECAR' } }],
      })
      .expect(400);
  });

  it('rejects duplicate layer orders within a program', async () => {
    const response = await authed().post('/reinsurance/programs').send({
      name: 'Duplicate Orders',
      currency: 'USD',
      layers: [
        { order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 1000 } },
        { order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 2000 } },
      ],
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a cession in a currency that does not match the program', async () => {
    const created = await authed()
      .post('/reinsurance/programs')
      .send({
        name: 'USD-only Program',
        currency: 'USD',
        layers: [{ order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 1000 } }],
      })
      .expect(201);

    const response = await authed()
      .post(`/reinsurance/programs/${created.body.program.id}/cede`)
      .send({ grossLossMinor: 10_000_00, currency: 'ZAR' });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('requires a credential', async () => {
    await request(http).post('/reinsurance/programs').send({}).expect(401);
  });

  it('rejects program creation from an organisation without the SYNDICATE role', async () => {
    const nonSyndicate = await bootstrapOrganisation('Non-Syndicate Co', ['*'], ['RISK_ORIGINATOR']);
    await request(http)
      .post('/reinsurance/programs')
      .set('Authorization', `Bearer ${nonSyndicate.token}`)
      .send({
        name: 'Should Fail',
        currency: 'USD',
        layers: [{ order: 1, params: { kind: 'QUOTA_SHARE', cededBps: 1000 } }],
      })
      .expect(403);
  });
});

describe('Phase 11: AI Agent API', () => {
  async function bootstrapAgent(
    permittedActions: string[],
    maxTransactionValueMinor: number,
    currency = 'USD',
  ): Promise<{ token: string; agentOrgId: string }> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const agentOrg = await identity.createOrganisation({
      id: `org-agent-${suffix}`,
      legalName: `Test Agent ${suffix}`,
      kind: 'AI_AGENT',
      jurisdiction: 'ZA',
      principalOrganisationId: rootOrgId,
    });
    for (const role of ['RISK_ORIGINATOR', 'BROKER', 'CAPITAL_PROVIDER', 'UNDERWRITER']) {
      await identity.grantRole(agentOrg.id, role as never);
    }

    const { keyId, secret, salt } = generateCredential();
    await identity.createCredential({
      id: `cred-${agentOrg.id}`,
      keyId,
      secretHash: hashSecret(secret, salt),
      secretSalt: salt,
      organisationId: agentOrg.id,
      label: 'agent-test',
      scopes: ['*'],
      subjectKind: 'AGENT',
      expiresAt: null,
    });

    await identity.createMandate({
      id: `mandate-${agentOrg.id}`,
      agentOrganisationId: agentOrg.id,
      principalOrganisationId: rootOrgId,
      permittedActions,
      maxTransactionValueMinor,
      currency,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    return { token: `${keyId}.${secret}`, agentOrgId: agentOrg.id };
  }

  it('lets a mandated agent submit activity', async () => {
    const { token } = await bootstrapAgent(['activity.submit'], 1_000_00);
    const risk = await createNode('RISK', 'agent-activity-risk', token);

    const response = await request(http)
      .post('/agent/activity')
      .set('Authorization', `Bearer ${token}`)
      .send({ riskId: risk, title: 'Agent-submitted activity' })
      .expect(201);
    expect(response.body.submission.status).toBe('DRAFT');
  });

  it('rejects an action outside the agent mandate\'s permitted actions', async () => {
    const { token } = await bootstrapAgent(['risk.assess'], 1_000_00); // no activity.submit
    const risk = await createNode('RISK', 'agent-forbidden-action-risk', token);

    await request(http)
      .post('/agent/activity')
      .set('Authorization', `Bearer ${token}`)
      .send({ riskId: risk, title: 'Should be forbidden' })
      .expect(403);
  });

  it('returns the indicative protection for a risk with an existing assessment, never binding it', async () => {
    const { token } = await bootstrapAgent(['protection.indicative'], 1_000_00);
    const risk = await createNode('RISK', 'agent-protection-risk', token);

    await request(http)
      .post(`/underwriting/risks/${risk}/assess`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        factors: [{ key: 'f1', description: 'test factor', weight: 1, likelihood: 0.3, confidence: 0.8, basis: 'EXPERT_JUDGEMENT' }],
        maximumEstimatedLossMinor: 100_000_00,
        currency: 'USD',
        durationDays: 30,
        mitigationCoverage: 0.5,
        correlatedRiskCount: 0,
        concentrationShare: 0.1,
      })
      .expect(201);

    const response = await request(http)
      .get(`/agent/risks/${risk}/indicative-protection`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.indicative).toBe(true);
    expect(response.body.disclosure).toContain('not a binding offer');
    expect(typeof response.body.humanApprovalRequired).toBe('boolean');
  });

  it('lists coverage options as open marketplace listings', async () => {
    const { token } = await bootstrapAgent(['coverage.browse'], 1_000_00);
    const response = await request(http)
      .get('/agent/coverage-options')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(response.body.listings)).toBe(true);
  });

  it('enforces the mandate transaction ceiling on permitted execution', async () => {
    const { token } = await bootstrapAgent(['coverage.bind'], 500_00); // ceiling: $500

    // Build a listable, underwritten risk under the agent's own organisation
    // so a real OPEN listing exists to execute against (tenant isolation
    // scopes resources to the acting organisation, not the principal's).
    const risk = await createNode('RISK', 'agent-exec-risk', token);
    const submissionResp = await request(http)
      .post('/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({ riskId: risk, title: 'Agent execution test submission' })
      .expect(201);
    const submission = submissionResp.body.submission;

    // Low likelihood/confidence factors keep this in the LOW approval band,
    // same as the Phase 4 e2e fixture, so no human underwriter approval is
    // needed before the listing can be created.
    await request(http)
      .post(`/underwriting/risks/${risk}/assess`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        factors: [
          { key: 'f1', description: 'd', weight: 1, likelihood: 0.01, confidence: 0.95, basis: 'STATISTICAL_MODEL' },
        ],
        maximumEstimatedLossMinor: 10_000,
        currency: 'USD',
        durationDays: 30,
        mitigationCoverage: 0,
        correlatedRiskCount: 0,
        concentrationShare: 0,
      })
      .expect(201);

    for (const to of ['SUBMITTED', 'ANALYSING', 'SCORED', 'READY_FOR_UNDERWRITING']) {
      await request(http)
        .post(`/submissions/${submission.id}/advance`)
        .set('Authorization', `Bearer ${token}`)
        .send({ to })
        .expect(201);
    }

    const listingResp = await request(http)
      .post('/marketplace/listings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        submissionId: submission.id,
        riskClass: 'test-class',
        capacityMinor: 1_000_000_00,
        currency: 'USD',
        durationDays: 30,
      })
      .expect(201);
    const listing = listingResp.body.listing;

    // Over the $500 mandate ceiling: rejected before expressInterest ever runs.
    await request(http)
      .post(`/agent/coverage-options/${listing.id}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({ indicativeAmountMinor: 1_000_00, currency: 'USD' })
      .expect(403);

    // Within the ceiling: succeeds (non-binding interest, Phase 4).
    const withinCeiling = await request(http)
      .post(`/agent/coverage-options/${listing.id}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({ indicativeAmountMinor: 400_00, currency: 'USD' })
      .expect(201);
    expect(withinCeiling.body.interest.organisationId).toBeTruthy();
  });

  it('rejects an expired mandate', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const agentOrg = await identity.createOrganisation({
      id: `org-expired-agent-${suffix}`,
      legalName: `Expired Agent ${suffix}`,
      kind: 'AI_AGENT',
      jurisdiction: 'ZA',
      principalOrganisationId: rootOrgId,
    });
    await identity.grantRole(agentOrg.id, 'RISK_ORIGINATOR');
    const { keyId, secret, salt } = generateCredential();
    await identity.createCredential({
      id: `cred-${agentOrg.id}`,
      keyId,
      secretHash: hashSecret(secret, salt),
      secretSalt: salt,
      organisationId: agentOrg.id,
      label: 'expired-agent',
      scopes: ['*'],
      subjectKind: 'AGENT',
      expiresAt: null,
    });
    await identity.createMandate({
      id: `mandate-${agentOrg.id}`,
      agentOrganisationId: agentOrg.id,
      principalOrganisationId: rootOrgId,
      permittedActions: ['activity.submit'],
      maxTransactionValueMinor: 1_000_00,
      currency: 'USD',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });
    const risk = await createNode('RISK', 'agent-expired-mandate-risk');

    await request(http)
      .post('/agent/activity')
      .set('Authorization', `Bearer ${keyId}.${secret}`)
      .send({ riskId: risk, title: 'Should be rejected: expired mandate' })
      .expect(403);
  });

  it('rejects an agent credential with no mandate at all', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const agentOrg = await identity.createOrganisation({
      id: `org-no-mandate-agent-${suffix}`,
      legalName: `No Mandate Agent ${suffix}`,
      kind: 'AI_AGENT',
      jurisdiction: 'ZA',
      principalOrganisationId: rootOrgId,
    });
    await identity.grantRole(agentOrg.id, 'RISK_ORIGINATOR');
    const { keyId, secret, salt } = generateCredential();
    await identity.createCredential({
      id: `cred-${agentOrg.id}`,
      keyId,
      secretHash: hashSecret(secret, salt),
      secretSalt: salt,
      organisationId: agentOrg.id,
      label: 'no-mandate-agent',
      scopes: ['*'],
      subjectKind: 'AGENT',
      expiresAt: null,
    });
    const risk = await createNode('RISK', 'agent-no-mandate-risk');

    await request(http)
      .post('/agent/activity')
      .set('Authorization', `Bearer ${keyId}.${secret}`)
      .send({ riskId: risk, title: 'Should be rejected: no mandate' })
      .expect(403);
  });

  it('does not gate a human caller behind mandate checks (assertAgentMayAct is a no-op for non-agents)', async () => {
    const risk = await createNode('RISK', 'agent-human-caller-risk');
    // rootToken is a SERVICE credential, not an AGENT — the same /agent/activity
    // route must work for it exactly like a normal human/service integration.
    await authed().post('/agent/activity').send({ riskId: risk, title: 'Human via agent route' }).expect(201);
  });

  it('requires a credential', async () => {
    await request(http).post('/agent/activity').send({}).expect(401);
  });
});

describe('Phase 10: Settlement', () => {
  it('initiates a bank-transfer settlement, computes the fee, and confirms via the Null provider', async () => {
    const response = await authed()
      .post('/settlement/transactions')
      .send({ method: 'BANK_TRANSFER', grossAmountMinor: 100_000_00, currency: 'USD' })
      .expect(201);

    const transaction = response.body.transaction;
    expect(transaction.id).toBeTruthy();
    expect(transaction.status).toBe('CONFIRMED');
    expect(transaction.method).toBe('BANK_TRANSFER');
    // Default fee: $0.50 flat + 0.25% of $100,000 = $0.50 + $250 = $250.50.
    expect(transaction.fee).toEqual({ amountMinor: 250_50, currency: 'USD' });
    expect(transaction.netAmount).toEqual({ amountMinor: 99_749_50, currency: 'USD' });
    expect(transaction.fee.amountMinor + transaction.netAmount.amountMinor).toBe(
      transaction.grossAmount.amountMinor,
    );
    expect(transaction.providerRef).toMatch(/^sim-bank_transfer-/);
  });

  it('accepts a custom fee configuration', async () => {
    const response = await authed()
      .post('/settlement/transactions')
      .send({
        method: 'DIGITAL_MONEY',
        grossAmountMinor: 10_000_00,
        currency: 'USD',
        feeFlatMinor: 0,
        feeBps: 100, // 1%
      })
      .expect(201);
    expect(response.body.transaction.fee).toEqual({ amountMinor: 10_000, currency: 'USD' });
  });

  it('supports STABLECOIN as a settlement method without hard-coding any specific coin or chain', async () => {
    const response = await authed()
      .post('/settlement/transactions')
      .send({ method: 'STABLECOIN', grossAmountMinor: 5_000_00, currency: 'USD' })
      .expect(201);
    expect(response.body.transaction.method).toBe('STABLECOIN');
    expect(response.body.transaction.providerRef).toMatch(/^sim-stablecoin-/);
  });

  it('retrieves a settlement transaction by id', async () => {
    const created = await authed()
      .post('/settlement/transactions')
      .send({ method: 'BANK_TRANSFER', grossAmountMinor: 1_000_00, currency: 'USD' })
      .expect(201);

    const fetched = await authed()
      .get(`/settlement/transactions/${created.body.transaction.id}`)
      .expect(200);
    expect(fetched.body.transaction.id).toBe(created.body.transaction.id);
  });

  it('lists settlement transactions for the organisation', async () => {
    await authed()
      .post('/settlement/transactions')
      .send({ method: 'BANK_TRANSFER', grossAmountMinor: 500_00, currency: 'USD' })
      .expect(201);

    const list = await authed().get('/settlement/transactions').expect(200);
    expect(Array.isArray(list.body.transactions)).toBe(true);
    expect(list.body.transactions.length).toBeGreaterThan(0);
  });

  it('links a settlement to a claim payout when provided', async () => {
    const response = await authed()
      .post('/settlement/transactions')
      .send({
        method: 'BANK_TRANSFER',
        grossAmountMinor: 1_000_00,
        currency: 'USD',
        claimPayoutClaimId: 'claim-fixture-id',
        claimPayoutOrganisationId: 'org-fixture-id',
      })
      .expect(201);
    expect(response.body.transaction.claimPayoutClaimId).toBe('claim-fixture-id');
    expect(response.body.transaction.claimPayoutOrganisationId).toBe('org-fixture-id');
  });

  it('rejects an unknown settlement method at the validation layer', async () => {
    await authed()
      .post('/settlement/transactions')
      .send({ method: 'CASH_IN_AN_ENVELOPE', grossAmountMinor: 1_000_00, currency: 'USD' })
      .expect(400);
  });

  it('requires a credential', async () => {
    await request(http).post('/settlement/transactions').send({}).expect(401);
  });

  it('rejects settlement initiation from an organisation without an authorised role', async () => {
    const unauthorised = await bootstrapOrganisation('No Settlement Role Co', ['*'], ['RISK_ORIGINATOR']);
    await request(http)
      .post('/settlement/transactions')
      .set('Authorization', `Bearer ${unauthorised.token}`)
      .send({ method: 'BANK_TRANSFER', grossAmountMinor: 1_000_00, currency: 'USD' })
      .expect(403);
  });
});
