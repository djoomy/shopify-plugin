import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vérification contre le bac à sable Djomy réel.
 *
 * Séparée de la suite unitaire : ces tests sortent sur le réseau, dépendent
 * d'un service tiers et n'ont donc pas leur place dans `npm test`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["verification/**/*.test.ts"],
    // Les paiements se créent puis se consultent : l'ordre compte.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 30_000,
    retry: 0,
  },
});
