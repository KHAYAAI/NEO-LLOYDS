import { Body, Controller, Inject, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  MARKET_ROLES,
  requireTenantAccess,
  type AuthContext,
  type MarketRole,
  type Organisation,
} from '@neo-lloyds/domain';
import { IdentityService } from './identity.service.js';
import { AuditService } from '../common/audit.service.js';
import { RequireScopes, type RequestWithAuth } from '../common/auth.js';

class CreateOrganisationDto {
  @IsString() @MaxLength(200) legalName: string;
  @IsIn(['COMPANY', 'INDIVIDUAL', 'AI_AGENT', 'REGULATOR']) kind: Organisation['kind'];
  @IsString() @Length(2, 2) jurisdiction: string;
  @IsOptional() @IsString() principalOrganisationId?: string;
}

class GrantRoleDto {
  @IsIn(MARKET_ROLES as unknown as string[]) role: MarketRole;
}

class KybDto {
  @IsIn(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'])
  status: Organisation['kybStatus'];
}

class IssueCredentialDto {
  @IsString() @MaxLength(200) label: string;
  @IsArray() @IsString({ each: true }) scopes: string[];
  @IsOptional() @IsIn(['USER', 'SERVICE', 'AGENT']) subjectKind?: 'USER' | 'SERVICE' | 'AGENT';
  @IsOptional() @IsISO8601() expiresAt?: string;
}

class ProvisionOidcUserDto {
  @IsString() email: string;
  @IsString() @MaxLength(200) displayName: string;
  @IsArray() @IsString({ each: true }) scopes: string[];
  @IsString() oidcIssuer: string;
  @IsString() oidcSubject: string;
}

class CreateMandateDto {
  @IsString() agentOrganisationId: string;
  @IsArray() @IsString({ each: true }) permittedActions: string[];
  @IsInt() @IsPositive() maxTransactionValueMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsISO8601() expiresAt: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('identity')
@Controller('identity')
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post('organisations')
  @RequireScopes('identity:admin')
  @ApiOperation({ summary: 'Register an organisation' })
  async create(@Req() req: RequestWithAuth, @Body() body: CreateOrganisationDto) {
    return { organisation: await this.identity.createOrganisation(auth(req), body) };
  }

  @Get('organisations')
  @RequireScopes('identity:read')
  @ApiOperation({ summary: 'List organisations' })
  async list() {
    return { organisations: await this.identity.listOrganisations() };
  }

  @Get('organisations/:id')
  @RequireScopes('identity:read')
  async get(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const organisation = await this.identity.getOrganisation(id);
    requireTenantAccess(auth(req), organisation.id, 'READ');
    return { organisation };
  }

  @Post('organisations/:id/roles')
  @RequireScopes('identity:admin')
  @ApiOperation({ summary: 'Grant a market role. Each role is a separate grant.' })
  async grantRole(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: GrantRoleDto,
  ) {
    return { organisation: await this.identity.grantRole(auth(req), id, body.role) };
  }

  @Post('organisations/:id/kyb')
  @RequireScopes('identity:admin')
  @ApiOperation({ summary: 'Record a KYB decision (prototype: manual only)' })
  async kyb(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: KybDto,
  ) {
    return { organisation: await this.identity.setKybStatus(auth(req), id, body.status) };
  }

  @Post('organisations/:id/credentials')
  @RequireScopes('identity:admin')
  @ApiOperation({
    summary: 'Issue an API credential. The secret is shown once and never again.',
  })
  async issueCredential(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: IssueCredentialDto,
  ) {
    const credential = await this.identity.issueCredential(auth(req), {
      organisationId: id,
      ...body,
    });
    return {
      credential,
      warning: 'Store the secret now. It is hashed at rest and cannot be retrieved again.',
    };
  }

  @Post('organisations/:id/oidc-users')
  @RequireScopes('identity:admin')
  @ApiOperation({
    summary:
      'Link a human at a configured OIDC issuer (OIDC_ISSUER_URL) to this organisation, for OIDC sign-in — security-model.md §10. There is no self-registration: an admin must already know the subject’s `sub` claim.',
  })
  async provisionOidcUser(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ProvisionOidcUserDto,
  ) {
    return { user: await this.identity.provisionOidcUser(auth(req), { organisationId: id, ...body }) };
  }

  @Post('credentials/:keyId/revoke')
  @RequireScopes('identity:admin')
  async revoke(@Req() req: RequestWithAuth, @Param('keyId') keyId: string) {
    await this.identity.revokeCredential(auth(req), keyId);
    return { revoked: keyId };
  }

  @Post('mandates')
  @RequireScopes('identity:admin')
  @ApiOperation({ summary: 'Grant a bounded, expiring mandate to an agent' })
  async createMandate(@Req() req: RequestWithAuth, @Body() body: CreateMandateDto) {
    return { mandate: await this.identity.createMandate(auth(req), body) };
  }

  @Get('audit')
  @RequireScopes('audit:read')
  @ApiOperation({ summary: 'Read the append-only audit log' })
  async auditLog(
    @Req() req: RequestWithAuth,
    @Query('subjectId') subjectId?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = auth(req);
    // A regulator may read across organisations; everyone else sees only their own.
    const organisationId = ctx.roles.includes('REGULATOR') ? undefined : ctx.organisationId;
    const records = await this.audit.list({
      ...(organisationId ? { organisationId } : {}),
      ...(subjectId ? { subjectId } : {}),
      limit: Math.min(Number(limit ?? 100) || 100, 500),
    });
    return { records };
  }
}
