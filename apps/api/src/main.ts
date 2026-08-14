import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SIMULATION_NOTICE } from '@neo-lloyds/domain';
import { AppModule } from './app.module.js';
import { DomainExceptionFilter } from './common/domain-exception.filter.js';
import { SimulationNoticeInterceptor } from './common/simulation.interceptor.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule.forRoot());

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new SimulationNoticeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Neo-Lloyds API — Phase 1')
    .setDescription(SIMULATION_NOTICE)
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer' })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  Logger.log(`Neo-Lloyds API on :${port} — ${SIMULATION_NOTICE}`, 'Bootstrap');
}

void bootstrap();
