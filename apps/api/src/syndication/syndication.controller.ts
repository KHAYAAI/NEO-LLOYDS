import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, Max, Min } from 'class-validator';
import type { AuthContext } from '@neo-lloyds/domain';
import { SyndicationService } from './syndication.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class OpenSyndicationDto {
  @IsString() listingId: string;
}

class ProposeAllocationDto {
  @IsInt() @Min(1) @Max(10_000) shareBps: number;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('syndication')
@Controller('syndication')
export class SyndicationController {
  constructor(@Inject(SyndicationService) private readonly syndication: SyndicationService) {}

  @Post()
  @RequireScopes('syndication:manage')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  @ApiOperation({ summary: 'Open a syndication against an OPEN listing. One per listing.' })
  async open(@Req() req: RequestWithAuth, @Body() body: OpenSyndicationDto) {
    return { syndication: await this.syndication.open(auth(req), body.listingId) };
  }

  @Get(':id')
  @RequireScopes('syndication:read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { syndication: await this.syndication.get(auth(req), id) };
  }

  @Post(':id/allocations')
  @RequireScopes('syndication:allocate')
  @RequireRoles('CAPITAL_PROVIDER')
  @ApiOperation({
    summary:
      'Propose an allocation, in basis points of the syndication capacity. Requires a live expression of interest on the underlying listing. Non-binding: freely add/removable until the syndication is bound.',
  })
  async propose(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ProposeAllocationDto,
  ) {
    return { allocations: await this.syndication.propose(auth(req), id, body.shareBps) };
  }

  @Delete(':id/allocations')
  @RequireScopes('syndication:allocate')
  @RequireRoles('CAPITAL_PROVIDER')
  @ApiOperation({ summary: "Withdraw the caller's own proposed allocation. Only while OPEN." })
  async withdraw(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.syndication.withdraw(auth(req), id);
    return { withdrawn: true };
  }

  @Get(':id/allocations')
  @RequireScopes('syndication:read')
  async listAllocations(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { allocations: await this.syndication.listAllocations(auth(req), id) };
  }

  @Get(':id/events')
  @RequireScopes('syndication:read')
  @ApiOperation({ summary: 'The complete, immutable allocation history for this syndication.' })
  async listEvents(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { events: await this.syndication.listEvents(auth(req), id) };
  }

  @Post(':id/bind')
  @RequireScopes('syndication:manage')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  @ApiOperation({
    summary:
      'THE BINDING CALL. Requires proposed allocations summing to exactly 100% (422 INCOMPLETE_ALLOCATION otherwise). Only the listing owner may bind, never a capital provider. Irreversible: after this call, allocations for this syndication cannot be altered by any code path, enforced by a database trigger.',
  })
  async bind(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { syndication: await this.syndication.bind(auth(req), id) };
  }
}
