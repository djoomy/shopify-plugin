import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Node 20+ fournit fetch nativement : aucun polyfill à installer.

// En `shopify app dev`, le CLI transmet l'URL du tunnel dans HOST : elle
// prime sur la valeur du .env.
if (process.env.HOST?.startsWith("https://")) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 3000),
    // Shopify sert l'app derrière un tunnel : l'hôte doit être autorisé.
    allowedHosts: true,
    hmr: hmrConfig(),
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*", "**/*.test.ts", "**/*.test.tsx"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
        v3_routeConfig: false,
      },
    }),
    tsconfigPaths(),
  ],
  build: { assetsInlineLimit: 0 },
});

function hmrConfig() {
  const url = process.env.SHOPIFY_APP_URL;
  if (!url) return undefined;
  const hote = new URL(url).hostname;
  return { protocol: "wss" as const, host: hote, port: 8002, clientPort: 443 };
}
