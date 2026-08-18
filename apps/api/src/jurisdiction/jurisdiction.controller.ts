import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  findJurisdictionModule,
  listJurisdictionModules,
  SUPPORTED_JURISDICTION_CODES,
} from '@neo-lloyds/config';
import { Public } from '../common/auth.js';

/**
 * Jurisdiction modules (ADR-0004, roadmap "Continuous" section). Published,
 * not hidden — same reasoning as the ontology endpoint: every organisation
 * declares a jurisdiction (docs/reports/phase-1's `ADR-0004`: never
 * defaulted), and this is where a caller can see what, if anything, this
 * platform currently knows about that jurisdiction's regulator, data
 * residency regime, and KYC/AML posture — and, just as importantly, that
 * every field is a stated illustrative summary, not legal advice.
 */
@ApiTags('jurisdiction')
@Controller('jurisdictions')
export class JurisdictionController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Every configured jurisdiction module, full detail.' })
  list() {
    return { jurisdictions: listJurisdictionModules(), supportedCodes: SUPPORTED_JURISDICTION_CODES };
  }

  @Public()
  @Get(':code')
  @ApiOperation({
    summary:
      'A single jurisdiction module by code (ISO-3166-1 alpha-2, or "EU"). ' +
      '404 if no module is configured — an organisation may still declare an ' +
      'unconfigured jurisdiction (ADR-0004 requires a jurisdiction, not a configured one), ' +
      'it just has no module-level rules published here yet.',
  })
  get(@Param('code') code: string) {
    const found = findJurisdictionModule(code.toUpperCase());
    if (!found) throw new NotFoundException(`No jurisdiction module configured for "${code}"`);
    return found;
  }
}
