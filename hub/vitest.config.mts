import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL(".", import.meta.url));

// Testes das funcionalidades (features/<nome>/testes/*.test.ts), com Postgres em memória (db/teste.ts).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: raiz },
      // Fora do Next o pacote "server-only" lança erro de propósito.
      { find: /^server-only$/, replacement: `${raiz}db/vazio.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["features/**/testes/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
