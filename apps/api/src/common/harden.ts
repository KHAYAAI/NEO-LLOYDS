import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Shared with both `main.ts` and the e2e test bootstrap, deliberately: if
 * this hardening only ever ran in the production entrypoint, the test suite
 * would never actually exercise it, and "verified once by hand" is a much
 * weaker guarantee than "asserted on every test run" (docs/security-model.md
 * §9).
 */
export function hardenApp(app: NestExpressApplication): void {
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Swagger UI's inline styles
          imgSrc: ["'self'", 'data:'],
        },
      },
      crossOriginEmbedderPolicy: false, // would otherwise block the Swagger UI's own assets
    }),
  );

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'DELETE'],
    credentials: false,
  });

  app.useBodyParser('json', { limit: '256kb' });
}
