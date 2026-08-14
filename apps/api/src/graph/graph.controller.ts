import { Body, Controller, Inject, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AuthContext, ProvenanceInput } from '@neo-lloyds/domain';
import { GraphService } from './graph.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class ProvenanceDto implements Partial<ProvenanceInput> {
  @IsString() @MaxLength(200) sourceId: string;

  @IsIn(['USER_DECLARED', 'DOCUMENT', 'EXTERNAL_FEED', 'SENSOR', 'DERIVED', 'AI_INFERRED'])
  sourceKind: ProvenanceInput['sourceKind'];

  @IsISO8601() observedAt: string;
  @IsNumber() @Min(0) @Max(1) confidence: number;

  @IsOptional() @IsString() modelId?: string;
  @IsOptional() @IsString() modelVersion?: string;
  @IsOptional() referencedData?: string[];
}

class CreateNodeDto {
  @IsString() type: string;
  @IsString() @MaxLength(300) label: string;
  @IsString() @Length(2, 2) jurisdiction: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @ValidateNested() @Type(() => ProvenanceDto) provenance: ProvenanceDto;
}

class CreateEdgeDto {
  @IsString() type: string;
  @IsString() fromId: string;
  @IsString() toId: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @ValidateNested() @Type(() => ProvenanceDto) provenance: ProvenanceDto;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

function scopeFrom(maxDepth?: string, verifiedOnly?: string) {
  return {
    ...(maxDepth ? { maxDepth: Math.min(Number(maxDepth) || 8, 12) } : {}),
    ...(verifiedOnly === 'true' ? { verifiedOnly: true } : {}),
  };
}

@ApiTags('risk-graph')
@Controller('graph')
export class GraphController {
  constructor(@Inject(GraphService) private readonly graph: GraphService) {}

  @Post('nodes')
  @RequireScopes('graph:write')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER', 'UNDERWRITER', 'SYNDICATE')
  @ApiOperation({ summary: 'Create a risk-graph node. Provenance is mandatory.' })
  async createNode(@Req() req: RequestWithAuth, @Body() body: CreateNodeDto) {
    return {
      node: await this.graph.createNode(auth(req), {
        ...body,
        provenance: body.provenance as unknown as ProvenanceInput,
      }),
    };
  }

  @Post('edges')
  @RequireScopes('graph:write')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER', 'UNDERWRITER', 'SYNDICATE')
  @ApiOperation({
    summary:
      'Create an edge. Rejected unless the ontology permits the endpoint pair, and DEPENDS_ON cycles are refused.',
  })
  async createEdge(@Req() req: RequestWithAuth, @Body() body: CreateEdgeDto) {
    return {
      edge: await this.graph.createEdge(auth(req), {
        ...body,
        provenance: body.provenance as unknown as ProvenanceInput,
      }),
    };
  }

  @Get('entities/:id/what-can-fail')
  @RequireScopes('graph:read')
  @ApiOperation({ summary: 'Q1. What can fail for this entity?' })
  async whatCanFail(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query('maxDepth') maxDepth?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
  ) {
    return {
      assets: await this.graph.whatCanFail(auth(req), id, scopeFrom(maxDepth, verifiedOnly)),
    };
  }

  @Get('assets/:id/dependencies')
  @RequireScopes('graph:read')
  @ApiOperation({ summary: 'Q2. What does this asset depend on, and what depends on it?' })
  async dependencies(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query('maxDepth') maxDepth?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
  ) {
    return this.graph.dependencies(auth(req), id, scopeFrom(maxDepth, verifiedOnly));
  }

  @Get('risks/:id/picture')
  @RequireScopes('graph:read')
  @ApiOperation({
    summary:
      'Q3–Q6. Who is exposed, what losses could result, what covers it, and which capital bears it.',
  })
  async riskPicture(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query('maxDepth') maxDepth?: string,
    @Query('verifiedOnly') verifiedOnly?: string,
  ) {
    return this.graph.riskPicture(auth(req), id, scopeFrom(maxDepth, verifiedOnly));
  }

  @Get('entities/:id/correlations')
  @RequireScopes('graph:read')
  @ApiOperation({ summary: 'Q7. Which entities share a dependency with this one?' })
  async correlations(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    return { correlations: await this.graph.correlations(auth(req), id, scopeFrom(maxDepth)) };
  }

  @Get('subgraph')
  @RequireScopes('graph:read')
  @ApiOperation({ summary: "The caller organisation's whole risk graph" })
  async subgraph(@Req() req: RequestWithAuth) {
    return this.graph.subgraph(auth(req));
  }
}
