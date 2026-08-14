/**
 * Bootstraps a local Neo-Lloyds environment: a root administrator credential,
 * the market participants for the MVP shipment scenario, and the risk graph
 * connecting them.
 *
 * SIMULATION / TEST ENVIRONMENT — NOT INSURANCE.
 * Every figure produced here is synthetic. It is not a quotation, not a
 * valuation, and not financial advice.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { SIMULATION_NOTICE } from '@neo-lloyds/domain';
import { generateCredential, hashSecret } from '../common/auth.js';

const prisma = new PrismaClient();

const PROV = {
  sourceId: 'seed:mvp-shipment',
  sourceKind: 'USER_DECLARED' as const,
  observedAt: new Date('2026-08-01T00:00:00Z'),
  recordedAt: new Date(),
  confidence: 0.9,
  referencedData: [] as string[],
};

async function organisation(
  legalName: string,
  kind: 'COMPANY' | 'REGULATOR',
  jurisdiction: string,
  roles: string[],
) {
  const org = await prisma.organisation.create({
    data: { id: randomUUID(), legalName, kind: kind as never, jurisdiction },
  });
  for (const role of roles) {
    await prisma.organisationRole.create({
      data: { organisationId: org.id, role: role as never, grantedBy: 'seed' },
    });
  }
  return org;
}

async function credential(organisationId: string, label: string, scopes: string[]) {
  const { keyId, secret, salt } = generateCredential();
  await prisma.apiCredential.create({
    data: {
      id: randomUUID(),
      keyId,
      secretHash: hashSecret(secret, salt),
      secretSalt: salt,
      organisationId,
      label,
      scopes,
    },
  });
  return `${keyId}.${secret}`;
}

async function node(organisationId: string, type: string, label: string) {
  return prisma.riskNode.create({
    data: {
      id: randomUUID(),
      organisationId,
      type: type as never,
      label,
      jurisdiction: 'ZA',
      ...PROV,
      sourceKind: PROV.sourceKind as never,
    },
  });
}

async function edge(type: string, fromId: string, toId: string) {
  return prisma.riskEdge.create({
    data: {
      id: randomUUID(),
      type: type as never,
      fromId,
      toId,
      ...PROV,
      sourceKind: PROV.sourceKind as never,
    },
  });
}

async function main(): Promise<void> {
  console.log(`\n${SIMULATION_NOTICE}\n`);

  const root = await organisation('Neo-Lloyds Platform Operations', 'COMPANY', 'ZA', [
    'RISK_ORIGINATOR',
    'BROKER',
    'UNDERWRITER',
    'SYNDICATE',
  ]);
  const rootToken = await credential(root.id, 'root-admin', ['*']);

  const regulator = await organisation('Test Regulator', 'REGULATOR', 'ZA', ['REGULATOR']);
  const regulatorToken = await credential(regulator.id, 'regulator', [
    'identity:read',
    'graph:read',
    'audit:read',
  ]);

  // The MVP scenario, written into the root organisation's graph.
  const shipper = await node(root.id, 'ENTITY', 'Kalahari Logistics (Pty) Ltd [TEST DATA]');
  const neighbour = await node(root.id, 'ENTITY', 'Highveld Produce Exports [TEST DATA]');
  const shipment = await node(root.id, 'ASSET', 'Shipment KL-8842 — 20ft reefer');
  const cargo = await node(root.id, 'ASSET', 'Cargo: citrus, 24t');
  const vessel = await node(root.id, 'ASSET', 'MV Agulhas');
  const port = await node(root.id, 'ASSET', 'Port of Durban — Berth 203');
  const neighbourCargo = await node(root.id, 'ASSET', 'Shipment HP-1190');
  const hazard = await node(root.id, 'HAZARD', 'East coast cut-off low');
  const risk = await node(root.id, 'RISK', 'Port closure exceeding 72 hours');
  const event = await node(root.id, 'EVENT', 'Durban closed 96 hours');
  const loss = await node(root.id, 'LOSS', 'Reefer cargo spoilage');
  const policy = await node(root.id, 'POLICY', 'Marine cargo cover [SIMULATED]');
  const syndicate = await node(root.id, 'SYNDICATE', 'Syndicate Alpha [TEST]');
  const capital = await node(root.id, 'CAPITAL', 'Fund I capacity commitment [TEST]');

  await edge('OWNS', shipper.id, shipment.id);
  await edge('OWNS', shipper.id, cargo.id);
  await edge('OWNS', neighbour.id, neighbourCargo.id);
  await edge('DEPENDS_ON', cargo.id, shipment.id);
  await edge('DEPENDS_ON', shipment.id, vessel.id);
  await edge('DEPENDS_ON', vessel.id, port.id);
  await edge('DEPENDS_ON', neighbourCargo.id, port.id);
  await edge('EXPOSED_TO', port.id, risk.id);
  await edge('MAY_CAUSE', hazard.id, risk.id);
  await edge('MAY_CAUSE', risk.id, event.id);
  await edge('MAY_CAUSE', event.id, loss.id);
  await edge('COVERS', policy.id, risk.id);
  await edge('ASSUMES', syndicate.id, risk.id);
  await edge('SUPPORTS', capital.id, syndicate.id);

  console.log('Seeded organisations, credentials and the MVP shipment risk graph.\n');
  console.log('Root credential (store it now — the secret is not recoverable):');
  console.log(`  ${rootToken}`);
  console.log('Regulator credential (read-only, cross-tenant reads are audited):');
  console.log(`  ${regulatorToken}\n`);
  console.log('Try:');
  console.log(`  curl -H "Authorization: Bearer ${rootToken}" \\`);
  console.log(`    localhost:3001/graph/entities/${shipper.id}/what-can-fail`);
  console.log(`  curl -H "Authorization: Bearer ${rootToken}" \\`);
  console.log(`    localhost:3001/graph/risks/${risk.id}/picture`);
  console.log(`  curl -H "Authorization: Bearer ${rootToken}" \\`);
  console.log(`    localhost:3001/graph/entities/${shipper.id}/correlations\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
