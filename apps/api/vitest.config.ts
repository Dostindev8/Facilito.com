import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    exclude: ['src/tests/isolation.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/tests/**'],
      reporter: ['text-summary', 'json-summary'],
    },
    env: {
      NODE_ENV: 'test',
      DATABASE_DRIVER: 'pglite',
      PGLITE_DATA_DIR: 'memory://',
      REDIS_URL: '',
      FIELD_ENCRYPTION_KEY: 'test-only-field-encryption-key-32b!',
      JWT_PRIVATE_KEY_PATH: './__none__/k.pem',
      JWT_PUBLIC_KEY_PATH: './__none__/k.pub',
      UPLOAD_DIR: './.data/test-uploads',
      AUTH_RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_MAX: '10000',
    },
  },
});
