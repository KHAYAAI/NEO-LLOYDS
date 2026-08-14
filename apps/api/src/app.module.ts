import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import {
  AUDIT_REPOSITORY,
  CLOCK,
  GRAPH_REPOSITORY,
  IDENTITY_REPOSITORY,
} from './persistence/ports.js';
import {
  PrismaAuditRepository,
  PrismaGraphRepository,
  PrismaIdentityRepository,
  PrismaService,
} from './persistence/prisma.repositories.js';
import { SystemClock } from './persistence/in-memory.js';

const CONTROLLERS = [
  HealthController,
  OntologyController,
  IdentityController,
  GraphController,
  ScoringController,
  SubmissionController,
  AnalystController,
];

/**
 * Phase 1+2 composition. Persistence is injected through ports, so the test
 * suite supplies in-memory adapters and everything above them is identical.
 */
@Module({})
export class AppModule {
  static withPersistence(providers: {
    identity: unknown;
    audit: unknown;
    graph: unknown;
    clock: unknown;
    analystProvider?: unknown;
    extra?: unknown[];
  }): DynamicModule {
    return {
      module: AppModule,
      controllers: CONTROLLERS,
      providers: [
        IdentityService,
        GraphService,
        ScoringService,
        SubmissionService,
        AnalystService,
        AuditService,
        { provide: IDENTITY_REPOSITORY, useValue: providers.identity },
        { provide: AUDIT_REPOSITORY, useValue: providers.audit },
        { provide: GRAPH_REPOSITORY, useValue: providers.graph },
        { provide: CLOCK, useValue: providers.clock },
        {
          provide: ANALYST_PROVIDER,
          useValue: providers.analystProvider ?? new NullAnalystProvider(),
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
      controllers: CONTROLLERS,
      providers: [
        PrismaService,
        IdentityService,
        GraphService,
        ScoringService,
        SubmissionService,
        AnalystService,
        AuditService,
        { provide: IDENTITY_REPOSITORY, useClass: PrismaIdentityRepository },
        { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
        { provide: GRAPH_REPOSITORY, useClass: PrismaGraphRepository },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ANALYST_PROVIDER, useFactory: createAnalystProvider },
        { provide: APP_GUARD, useClass: ApiCredentialGuard },
      ],
    };
  }
}
