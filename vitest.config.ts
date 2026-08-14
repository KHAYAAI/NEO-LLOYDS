import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The API is decorator-driven: NestJS DI and class-validator both rely on
 * `emitDecoratorMetadata`, which esbuild does not emit. Compiling tests with
 * SWC instead means the suite exercises the same validation and injection
 * behaviour that the tsc-built production bundle has — without it, request
 * validation silently no-ops and the tests would prove nothing.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
