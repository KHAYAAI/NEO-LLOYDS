/**
 * Domain errors. These describe violations of the model's invariants and are
 * always the caller's fault, never an infrastructure failure.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** An edge whose endpoints are not permitted by the ontology. */
export class InvalidEdgeError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, 'INVALID_EDGE', details);
  }
}

/** A DEPENDS_ON edge that would close a cycle. */
export class DependencyCycleError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, 'DEPENDENCY_CYCLE', details);
  }
}

/** A reference to a node that does not exist in the graph. */
export class UnknownNodeError extends DomainError {
  constructor(nodeId: string) {
    super(`Unknown node: ${nodeId}`, 'UNKNOWN_NODE', { nodeId });
  }
}

/** Provenance missing, incomplete, or self-contradictory. */
export class ProvenanceError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, 'INVALID_PROVENANCE', details);
  }
}

/** Money or estimate arithmetic that cannot be performed exactly. */
export class MoneyError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, 'INVALID_MONEY', details);
  }
}

/** The caller is not permitted to perform the action. */
export class AuthorizationError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, 'FORBIDDEN', details);
  }
}
