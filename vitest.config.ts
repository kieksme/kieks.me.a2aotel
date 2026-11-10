import { defineConfig } from "vitest/config";

// Eigene Konfiguration, damit Vitest nicht die Vite-Konfiguration der Demo
// (mit root "demo") übernimmt.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
