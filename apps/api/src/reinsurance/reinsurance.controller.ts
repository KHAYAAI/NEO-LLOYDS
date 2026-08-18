import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { REINSURANCE_LAYER_KINDS, type AuthContext, type ReinsuranceLayerKind } from '@neo-lloyds/domain';
import { ReinsuranceService } from './reinsurance.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class LayerParamsDto {
  @IsIn(REINSURANCE_LAYER_KINDS as unknown as string[]) kind: ReinsuranceLayerKind;
  @IsOptional() @IsInt() @Min(1) cededBps?: number;
  @IsOptional() @IsInt() @Min(0) perLossLimitMinor?: number;
  @IsOptional() @IsInt() @Min(0) attachmentPointMinor?: number;
  @IsOptional() @IsInt() @Min(0) limitMinor?: number;
}

class CreateLayerDto {
  @IsInt() @Min(1) order: number;
  @ValidateNested() @Type(() => LayerParamsDto) params: LayerParamsDto;
}

class CreateProgramDto {
  @IsString() name: string;
  @IsString() @Length(3, 3) currency: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateLayerDto) layers: CreateLayerDto[];
}

class CedeDto {
  @IsInt() @IsPositive() grossLossMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsOptional() @IsString() claimId?: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

function toLayerParams(dto: LayerParamsDto) {
  if (dto.kind === 'QUOTA_SHARE') {
    return {
      kind: 'QUOTA_SHARE' as const,
      cededBps: dto.cededBps ?? 0,
      ...(dto.perLossLimitMinor !== undefined
        ? { perLossLimit: { amountMinor: dto.perLossLimitMinor, currency: 'XXX' } }
        : {}),
    };
  }
  return {
    kind: dto.kind,
    attachmentPoint: { amountMinor: dto.attachmentPointMinor ?? 0, currency: 'XXX' },
    limit: { amountMinor: dto.limitMinor ?? 0, currency: 'XXX' },
  };
}

@ApiTags('reinsurance')
@Controller('reinsurance')
export class ReinsuranceController {
  constructor(@Inject(ReinsuranceService) private readonly reinsurance: ReinsuranceService) {}

  @Post('programs')
  @RequireScopes('reinsurance:write')
  @RequireRoles('SYNDICATE')
  @ApiOperation({
    summary:
      'Configures a reinsurance program: an ordered set of layers (quota share, excess of loss, aggregate) ' +
      'a cedant can run losses through. A software abstraction, not a binding reinsurance contract — see docs/reports/phase-9.md.',
  })
  async createProgram(@Req() req: RequestWithAuth, @Body() body: CreateProgramDto) {
    // The currency placeholder in toLayerParams is replaced with the
    // program's actual currency here, since layer money fields are defined
    // in the program's currency, not chosen independently per layer.
    const layers = body.layers.map((l) => {
      const params = toLayerParams(l.params);
      const withCurrency =
        params.kind === 'QUOTA_SHARE'
          ? {
              ...params,
              ...(params.perLossLimit ? { perLossLimit: { ...params.perLossLimit, currency: body.currency } } : {}),
            }
          : {
              ...params,
              attachmentPoint: { ...params.attachmentPoint, currency: body.currency },
              limit: { ...params.limit, currency: body.currency },
            };
      return { order: l.order, kind: l.params.kind, params: withCurrency };
    });

    const program = await this.reinsurance.createProgram(auth(req), {
      name: body.name,
      currency: body.currency,
      layers,
    });
    return { program };
  }

  @Get('programs/:id')
  @RequireScopes('reinsurance:read')
  async getProgram(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { program: await this.reinsurance.getProgram(auth(req), id) };
  }

  @Get('programs')
  @RequireScopes('reinsurance:read')
  async listPrograms(@Req() req: RequestWithAuth) {
    return { programs: await this.reinsurance.listPrograms(auth(req)) };
  }

  @Post('programs/:id/cede')
  @RequireScopes('reinsurance:write')
  @RequireRoles('SYNDICATE')
  @ApiOperation({
    summary:
      'THE CESSION CALCULATION. Runs a gross loss through the program\'s layers in order and persists the split ' +
      'between what is ceded and what the cedant retains. Optionally tagged with a claimId for audit linkage.',
  })
  async cede(@Req() req: RequestWithAuth, @Param('id') id: string, @Body() body: CedeDto) {
    const cession = await this.reinsurance.cede(
      auth(req),
      id,
      { amountMinor: body.grossLossMinor, currency: body.currency },
      body.claimId ?? null,
    );
    return { cession };
  }

  @Get('programs/:id/cessions')
  @RequireScopes('reinsurance:read')
  async listCessions(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { cessions: await this.reinsurance.listCessions(auth(req), id) };
  }
}
