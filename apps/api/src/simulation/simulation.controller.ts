import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { SIMULATION_SCENARIO_KINDS, type AuthContext, type SimulationScenarioKind } from '@neo-lloyds/domain';
import { SimulationService } from './simulation.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class RunSimulationDto {
  @IsIn(SIMULATION_SCENARIO_KINDS as unknown as string[]) kind: SimulationScenarioKind;
  @IsString() triggerNodeId: string;
  @IsNumber() @IsPositive() durationDays: number;
  @IsNumber() @Min(0) @Max(1) severity: number;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @Length(3, 3) currency: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('simulation')
@Controller('simulation')
export class SimulationController {
  constructor(@Inject(SimulationService) private readonly simulation: SimulationService) {}

  @Post()
  @RequireScopes('simulation:run')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER', 'SYNDICATE', 'CLAIMS_ADMINISTRATOR')
  @ApiOperation({
    summary:
      'Run a scenario forward from the risk graph: what would this event do to what is insured here. ' +
      'Outputs exposed entities, affected assets, an estimated loss (deliberately low-confidence — see docs/reports/phase-8.md), ' +
      'correlated exposure, capital requirement and an insured-vs-uninsured split. The result is persisted.',
  })
  async run(@Req() req: RequestWithAuth, @Body() body: RunSimulationDto) {
    const run = await this.simulation.run(
      auth(req),
      {
        kind: body.kind,
        triggerNodeId: body.triggerNodeId,
        durationDays: body.durationDays,
        severity: body.severity,
        ...(body.description ? { description: body.description } : {}),
      },
      body.currency,
    );
    return { simulationRun: run };
  }

  @Get(':id')
  @RequireScopes('simulation:read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { simulationRun: await this.simulation.get(auth(req), id) };
  }

  @Get()
  @RequireScopes('simulation:read')
  @ApiOperation({ summary: "List this organisation's past simulation runs, most recent first." })
  async list(@Req() req: RequestWithAuth) {
    return { simulationRuns: await this.simulation.list(auth(req)) };
  }
}
