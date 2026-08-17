import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SIMULATION_NOTICE } from '@neo-lloyds/domain';
import { AppModule } from './app.module.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { SimulationNoticeInterceptor } from './common/simulation.interceptor.js';
import { hardenApp } from './common/harden.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot());

  hardenApp(app);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new SimulationNoticeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());

  // Swagger exposes the full request/response schema, including every
  // internal error code — useful for integrators, but not something to
  // publish unauthenticated on a production origin by default. Opt in
  // explicitly rather than opt out.
  if (process.env.ENABLE_API_DOCS === 'true' || process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Neo-Lloyds API — Phase 1–8')
      .setDescription(SIMULATION_NOTICE)
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' })
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  Logger.log(`Neo-Lloyds API on :${port} — ${SIMULATION_NOTICE}`, 'Bootstrap');
}

void bootstrap();
