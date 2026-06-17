import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

export default defineConfig({
  output: "server",
  security: {
    checkOrigin: false,
  },
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
      // Wskazuje na lokalne bindingi zdefiniowane w wrangler.toml
      configPath: "wrangler.toml",
      environment: undefined,
    },
  }),
  integrations: [react()],
});