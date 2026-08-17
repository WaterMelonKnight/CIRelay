import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['{packages,apps}/**/*.test.ts'], environment: 'node' },
});
