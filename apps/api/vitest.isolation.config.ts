import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/isolation.test.ts', 'src/tests/isolation-contract.test.ts'],
    fileParallelism: false,
  },
});
