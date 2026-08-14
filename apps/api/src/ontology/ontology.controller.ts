import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EDGE_RULES, NODE_TYPES, ONTOLOGY_VERSION, ontologyDocument } from '@neo-lloyds/domain';
import { Public } from '../common/auth.js';

/**
 * The ontology is published, not hidden: integrators and reviewers need the
 * exact vocabulary the graph will accept, and it is the same data the server
 * validates against (domain-model.md §2).
 */
@ApiTags('ontology')
@Controller('ontology')
export class OntologyController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'The machine-readable risk ontology' })
  get() {
    return ontologyDocument();
  }

  @Public()
  @Get('version')
  @ApiOperation({ summary: 'Ontology version, recorded on every audit record' })
  version() {
    return {
      version: ONTOLOGY_VERSION,
      nodeTypeCount: NODE_TYPES.length,
      edgeRuleCount: EDGE_RULES.length,
    };
  }
}
