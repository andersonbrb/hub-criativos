import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const raiz = fileURLToPath(new URL(".", import.meta.url));

// Testes das funcionalidades (features/<nome>/testes/*.test.ts), com Postgres em memória (db/teste.ts). O núcleo do
// Instagram mantém os testes ao lado do código, como no projeto de origem.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: raiz },
      // Fora do Next o pacote "server-only" lança erro de propósito.
      { find: /^server-only$/, replacement: `${raiz}db/vazio.ts` },
      // Núcleo do Instagram (features/instagram/nucleo): cada parte com o nome de pacote que ela já usava.
      { find: /^@sbs\/([\w-]+)\/testing$/, replacement: `${raiz}features/instagram/nucleo/$1/testing/index.ts` },
      { find: /^@sbs\/([\w-]+)$/, replacement: `${raiz}features/instagram/nucleo/$1/index.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["features/**/testes/**/*.test.ts", "features/instagram/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
