import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AuthContext } from '@neo-lloyds/domain';
import { MarketplaceService } from './marketplace.service.js';
import { RequireRoles, RequireScopes, type RequestWithAuth } from '../common/auth.js';

class ListSubmissionDto {
  @IsString() submissionId: string;
  @IsString() @MaxLength(100) riskClass: string;
  @IsInt() @IsPositive() capacityMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsInt() @Min(1) durationDays: number;
}

class AppetiteDto {
  @IsArray() @IsString({ each: true }) preferredRiskClasses: string[];
  @IsInt() @IsPositive() maxExposureMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsArray() @IsString({ each: true }) preferredJurisdictions: string[];
  @IsInt() @Min(0) minimumReturnBps: number;
  @IsInt() @Min(1) maxDurationDays: number;
  @IsIn(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']) riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  @IsInt() @Min(0) @Max(10_000) concentrationLimitBps: number;
}

class ExpressInterestDto {
  @IsInt() @IsPositive() indicativeAmountMinor: number;
  @IsString() @Length(3, 3) currency: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

function auth(req: RequestWithAuth): AuthContext {
  if (!req.auth) throw new Error('Guard did not populate the auth context');
  return req.auth;
}

@ApiTags('marketplace')
@Controller('marketplace')
export class MarketplaceController {
  constructor(@Inject(MarketplaceService) private readonly marketplace: MarketplaceService) {}

  @Post('listings')
  @RequireScopes('marketplace:list')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  @ApiOperation({
    summary:
      'List a READY_FOR_UNDERWRITING submission. Requires current underwriting clearance — re-checked at listing time, not cached.',
  })
  async createListing(@Req() req: RequestWithAuth, @Body() body: ListSubmissionDto) {
    const listing = await this.marketplace.listSubmission(auth(req), {
      submissionId: body.submissionId,
      riskClass: body.riskClass,
      capacity: { amountMinor: body.capacityMinor, currency: body.currency },
      durationDays: body.durationDays,
    });
    return { listing };
  }

  @Post('listings/:id/withdraw')
  @RequireScopes('marketplace:list')
  @RequireRoles('RISK_ORIGINATOR', 'BROKER')
  async withdrawListing(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.marketplace.withdrawListing(auth(req), id);
    return { withdrawn: id };
  }

  @Get('listings/:id')
  @RequireScopes('marketplace:read')
  async getListing(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { listing: await this.marketplace.getListing(auth(req), id) };
  }

  @Get('listings')
  @RequireScopes('marketplace:read')
  @ApiOperation({ summary: 'Browse open listings, optionally filtered by risk class and jurisdiction' })
  async browseListings(
    @Query('riskClass') riskClass?: string,
    @Query('jurisdiction') jurisdiction?: string,
  ) {
    return {
      listings: await this.marketplace.browseListings({
        ...(riskClass ? { riskClass } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
      }),
    };
  }

  @Post('appetite')
  @RequireScopes('marketplace:appetite')
  @RequireRoles('CAPITAL_PROVIDER')
  @ApiOperation({ summary: "Set the caller's capital appetite profile (replaces any existing one)" })
  async setAppetite(@Req() req: RequestWithAuth, @Body() body: AppetiteDto) {
    const appetite = await this.marketplace.setAppetite(auth(req), {
      preferredRiskClasses: body.preferredRiskClasses,
      maxExposure: { amountMinor: body.maxExposureMinor, currency: body.currency },
      preferredJurisdictions: body.preferredJurisdictions,
      minimumReturnBps: body.minimumReturnBps,
      maxDurationDays: body.maxDurationDays,
      riskTolerance: body.riskTolerance,
      concentrationLimitBps: body.concentrationLimitBps,
    });
    return { appetite };
  }

  @Get('appetite')
  @RequireScopes('marketplace:appetite')
  async getAppetite(@Req() req: RequestWithAuth) {
    return { appetite: await this.marketplace.getAppetite(auth(req)) };
  }

  @Get('appetite/matches')
  @RequireScopes('marketplace:appetite')
  @ApiOperation({
    summary:
      'Open listings ranked against the caller\'s declared appetite. Every non-match carries its explicit reasons.',
  })
  async matches(@Req() req: RequestWithAuth) {
    return { matches: await this.marketplace.matchingListings(auth(req)) };
  }

  @Post('listings/:id/interest')
  @RequireScopes('marketplace:interest')
  @RequireRoles('CAPITAL_PROVIDER')
  @ApiOperation({
    summary:
      'Express non-binding indicative interest in a listing. Syndication (Phase 5) is what turns interest into a binding allocation.',
  })
  async expressInterest(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: ExpressInterestDto,
  ) {
    const interest = await this.marketplace.expressInterest(
      auth(req),
      id,
      { amountMinor: body.indicativeAmountMinor, currency: body.currency },
      body.note,
    );
    return { interest };
  }

  @Delete('listings/:id/interest')
  @RequireScopes('marketplace:interest')
  @RequireRoles('CAPITAL_PROVIDER')
  async withdrawInterest(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.marketplace.withdrawInterest(auth(req), id);
    return { withdrawn: id };
  }

  @Get('listings/:id/interest')
  @RequireScopes('marketplace:read')
  async listInterests(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return { interests: await this.marketplace.listInterests(auth(req), id) };
  }
}
