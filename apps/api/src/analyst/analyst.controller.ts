import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '@neo-lloyds/domain';
import { AnalystService } from './analyst.service.js';
import { RequireScopes, type RequestWithAuth } from '../common/auth.js';

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('ai-analyst')
@Controller('analyst')
export class AnalystController {
  constructor(@Inject(AnalystService) private readonly analyst: AnalystService) {}

  @Get('risks/:id')
  @RequireScopes('graph:read')
  @ApiOperation({
    summary:
      'Advisory-only AI analysis of a risk: summary, dependencies, missing/conflicting information, proposed factors, underwriting questions, anomalies. Every finding cites its model and source data; never a black-box conclusion.',
  })
  async analyseRisk(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.analyst.analyseRisk(auth(req), id);
  }
}
