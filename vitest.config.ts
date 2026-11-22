import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["app/lib/**/*.ts"],
      exclude: [
        // Les tests eux-mêmes ne sont pas du code couvert.
        "app/lib/**/*.test.ts",
        // Fichiers purement déclaratifs : rien à exécuter, donc rien à couvrir.
        "app/lib/**/index.ts",
        "app/lib/djomy/types.ts",
        "app/lib/ui/**",
        // Adaptateurs d'entrée-sortie : ils ne contiennent aucune décision
        // métier, seulement la traduction vers Prisma et l'Admin API Shopify.
        // Ils exigent une vraie base et une vraie session pour être exercés :
        // c'est la recette d'intégration (phase P5) qui les couvre, pas les
        // tests unitaires. Voir docs/KNOWN-ISSUES.md.
        "app/lib/marchand/depot.server.ts",
        "app/lib/paiements/depot.server.ts",
        "app/lib/paiements/commandes.server.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
