import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter.js';
import { SimulationNoticeInterceptor } from '../src/common/simulation.interceptor.js';
import {
  InMemoryAuditRepository,
  InMemoryGraphRepository,
  InMemoryIdentityRepository,
  SystemClock,
} from '../src/persistence/in-memory.js';
import { generateCredential, hashSecret } from '../src/common/auth.js';

const identity = new InMemoryIdentityRepository();
const audit = new InMemoryAuditRepository();
const graphRepo = new InMemoryGraphRepository();

let app: INestApplication;
let http: string;

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
        clock: new SystemClock(),
      }),
    ],
  }).compile();

  app = moduleRef.createNestApplication();
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

describe('identity and governance', () => {
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
