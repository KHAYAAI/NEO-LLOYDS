import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DomainError, SIMULATION_NOTICE } from '@neo-lloyds/domain';
import type { Response } from 'express';

/**
 * Translates domain invariant violations into HTTP responses. Domain errors are
 * always the caller's fault, so they map to 4xx and carry their machine-readable
 * code — never a stack trace.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error.code === 'FORBIDDEN' ? HttpStatus.FORBIDDEN : HttpStatus.UNPROCESSABLE_ENTITY;

    this.logger.warn(`${error.code}: ${error.message}`);

    response.status(status).json({
      error: { code: error.code, message: error.message, details: error.details },
      notice: SIMULATION_NOTICE,
    });
  }
}
