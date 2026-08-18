import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiCredentialGuard } from './common/auth.js';
import { AuditService } from './common/audit.service.js';
import { HealthController } from './common/health.controller.js';
import { IdentityController } from './identity/identity.controller.js';
import { IdentityService } from './identity/identity.service.js';
import { GraphController } from './graph/graph.controller.js';
import { GraphService } from './graph/graph.service.js';
import { OntologyController } from './ontology/ontology.controller.js';
import { ScoringController } from './scoring/scoring.controller.js';
import { ScoringService } from './scoring/scoring.service.js';
import { SubmissionController } from './submission/submission.controller.js';
import { SubmissionService } from './submission/submission.service.js';
import { AnalystController } from './analyst/analyst.controller.js';
import { AnalystService } from './analyst/analyst.service.js';
import { ANALYST_PROVIDER } from './analyst/tokens.js';
import { createAnalystProvider, NullAnalystProvider } from './analyst/providers.js';
import { UnderwritingController } from './underwriting/underwriting.controller.js';
import { UnderwritingService } from './underwriting/underwriting.service.js';
import { MarketplaceController } from './marketplace/marketplace.controller.js';
import { MarketplaceService } from './marketplace/marketplace.service.js';
import { SyndicationController } from './syndication/syndication.controller.js';
import { SyndicationService } from './syndication/syndication.service.js';
import { CapitalController } from './capital/capital.controller.js';
import { CapitalService } from './capital/capital.service.js';
import { ClaimsController } from './claims/claims.controller.js';
import { ClaimsService } from './claims/claims.service.js';
import { SimulationController } from './simulation/simulation.controller.js';
import { SimulationService } from './simulation/simulation.service.js';
import { ReinsuranceController } from './reinsurance/reinsurance.controller.js';
import { ReinsuranceService } from './reinsurance/reinsurance.service.js';
import { SettlementController } from './settlement/settlement.controller.js';
import { SettlementService } from './settlement/settlement.service.js';
import { SETTLEMENT_PROVIDER } from './settlement/tokens.js';
import { createSettlementProvider } from './settlement/providers.js';
import { AgentController } from './agent/agent.controller.js';
import { AgentService } from './agent/agent.service.js';
import { JurisdictionController } from './jurisdiction/jurisdiction.controller.js';
import {
  AUDIT_REPOSITORY,
  CAPITAL_REPOSITORY,
  CLAIMS_REPOSITORY,
  CLOCK,
  GRAPH_REPOSITORY,
  IDENTITY_REPOSITORY,
  MARKETPLACE_REPOSITORY,
  REINSURANCE_REPOSITORY,
  SETTLEMENT_REPOSITORY,
  SIMULATION_REPOSITORY,
  SUBMISSION_REPOSITORY,
  SYNDICATION_REPOSITORY,
  UNDERWRITING_REPOSITORY,
} from './persistence/ports.js';
import {
  PrismaAuditRepository,
  PrismaCapitalRepository,
  PrismaClaimsRepository,
  PrismaGraphRepository,
  PrismaIdentityRepository,
  PrismaMarketplaceRepository,
  PrismaReinsuranceRepository,
  PrismaService,
  PrismaSettlementRepository,
  PrismaSimulationRepository,
  PrismaSubmissionRepository,
  PrismaSyndicationRepository,
  PrismaUnderwritingRepository,
} from './persistence/prisma.repositories.js';
import { SystemClock } from './persistence/in-memory.js';

/**
 * Global IP-based rate limit, in front of the per-credential auth guard —
 * this is what stops a credential-guessing loop from being cheap, since it
 * caps request volume before a single secret comparison happens. Configurable
 * because the right ceiling depends on real traffic patterns this prototype
 * has none of yet; the default is deliberately generous for local dev and
 * integration testing, not tuned for a production SLA.
 */
const THROTTLER_IMPORTS = [
  ThrottlerModule.forRoot([
    {
      ttl: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
      limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 300),
    },
  ]),
];

const CONTROLLERS = [
  HealthController,
  OntologyController,
  JurisdictionController,
  IdentityController,
  GraphController,
  ScoringController,
  SubmissionController,
  AnalystController,
  UnderwritingController,
  MarketplaceController,
  SyndicationController,
  CapitalController,
  ClaimsController,
  SimulationController,
  ReinsuranceController,
  SettlementController,
  AgentController,
];

const SERVICES = [
  IdentityService,
  GraphService,
  ScoringService,
  SubmissionService,
  AnalystService,
  UnderwritingService,
  MarketplaceService,
  SyndicationService,
  CapitalService,
  ClaimsService,
  SimulationService,
  ReinsuranceService,
  SettlementService,
  AgentService,
  AuditService,
];

/**
 * Phase 1–7 composition. Persistence is injected through ports, so the test
 * suite supplies in-memory adapters and everything above them is identical.
 */
@Module({})
export class AppModule {
  static withPersistence(providers: {
    identity: unknown;
    audit: unknown;
    graph: unknown;
    submission: unknown;
    underwriting: unknown;
    marketplace: unknown;
    syndication: unknown;
    capital: unknown;
    claims: unknown;
    simulation: unknown;
    reinsurance: unknown;
    settlement: unknown;
    clock: unknown;
    analystProvider?: unknown;
    settlementProvider?: unknown;
    extra?: unknown[];
  }): DynamicModule {
    return {
      module: AppModule,
      imports: THROTTLER_IMPORTS,
      controllers: CONTROLLERS,
      providers: [
        ...SERVICES,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: IDENTITY_REPOSITORY, useValue: providers.identity },
        { provide: AUDIT_REPOSITORY, useValue: providers.audit },
        { provide: GRAPH_REPOSITORY, useValue: providers.graph },
        { provide: SUBMISSION_REPOSITORY, useValue: providers.submission },
        { provide: UNDERWRITING_REPOSITORY, useValue: providers.underwriting },
        { provide: MARKETPLACE_REPOSITORY, useValue: providers.marketplace },
        { provide: SYNDICATION_REPOSITORY, useValue: providers.syndication },
        { provide: CAPITAL_REPOSITORY, useValue: providers.capital },
        { provide: CLAIMS_REPOSITORY, useValue: providers.claims },
        { provide: SIMULATION_REPOSITORY, useValue: providers.simulation },
        { provide: REINSURANCE_REPOSITORY, useValue: providers.reinsurance },
        { provide: SETTLEMENT_REPOSITORY, useValue: providers.settlement },
        { provide: CLOCK, useValue: providers.clock },
        {
          provide: ANALYST_PROVIDER,
          useValue: providers.analystProvider ?? new NullAnalystProvider(),
        },
        {
          provide: SETTLEMENT_PROVIDER,
          useValue: providers.settlementProvider ?? createSettlementProvider(),
        },
        { provide: APP_GUARD, useClass: ApiCredentialGuard },
        ...((providers.extra ?? []) as never[]),
      ],
    };
  }

  /** Production wiring: PostgreSQL via Prisma. */
  static forRoot(): DynamicModule {
    return {
      module: AppModule,
      imports: THROTTLER_IMPORTS,
      controllers: CONTROLLERS,
      providers: [
        PrismaService,
        ...SERVICES,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: IDENTITY_REPOSITORY, useClass: PrismaIdentityRepository },
        { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
        { provide: GRAPH_REPOSITORY, useClass: PrismaGraphRepository },
        { provide: SUBMISSION_REPOSITORY, useClass: PrismaSubmissionRepository },
        { provide: UNDERWRITING_REPOSITORY, useClass: PrismaUnderwritingRepository },
        { provide: MARKETPLACE_REPOSITORY, useClass: PrismaMarketplaceRepository },
        { provide: SYNDICATION_REPOSITORY, useClass: PrismaSyndicationRepository },
        { provide: CAPITAL_REPOSITORY, useClass: PrismaCapitalRepository },
        { provide: CLAIMS_REPOSITORY, useClass: PrismaClaimsRepository },
        { provide: SIMULATION_REPOSITORY, useClass: PrismaSimulationRepository },
        { provide: REINSURANCE_REPOSITORY, useClass: PrismaReinsuranceRepository },
        { provide: SETTLEMENT_REPOSITORY, useClass: PrismaSettlementRepository },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ANALYST_PROVIDER, useFactory: createAnalystProvider },
        { provide: SETTLEMENT_PROVIDER, useFactory: createSettlementProvider },
        { provide: APP_GUARD, useClass: ApiCredentialGuard },
      ],
    };
  }
}
