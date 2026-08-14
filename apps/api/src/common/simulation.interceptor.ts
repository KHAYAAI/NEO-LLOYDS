import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { SIMULATION_NOTICE } from '@neo-lloyds/domain';
import { map, Observable } from 'rxjs';

/**
 * Stamps every response with the simulation notice. Non-negotiable principles
 * 2 and 3: nothing this system produces may be mistaken for authorised
 * insurance, and the disclaimer is applied centrally so no endpoint can
 * accidentally omit it.
 */
@Injectable()
export class SimulationNoticeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body) =>
        body !== null && typeof body === 'object' && !Array.isArray(body)
          ? { ...(body as Record<string, unknown>), notice: SIMULATION_NOTICE }
          : { data: body, notice: SIMULATION_NOTICE },
      ),
    );
  }
}
