import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Web tests select jsdom with a `// @vitest-environment jsdom` comment.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'] },
});
