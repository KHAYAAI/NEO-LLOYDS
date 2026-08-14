import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ONTOLOGY_VERSION } from '@neo-lloyds/domain';
import { Public } from './auth.js';

@ApiTags('health')
@Controller()
export class HealthController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return {
      status: 'ok',
      phase: 1,
      ontologyVersion: ONTOLOGY_VERSION,
      environment: 'SIMULATION',
    };
  }
}
