import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    // Włącza lokalny proxy dla bindings (D1, KV, itp.) podczas `astro dev`
  security: {
    checkOrigin: false,
    },
    platformProxy: {
      enabled: true,
      // Wskazuje na lokalne bindingi zdefiniowane w wrangler.toml
      configPath: "wrangler.toml",
      environment: undefined,
    },
  }),
  integrations: [react()],
});
