/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  GEMINI_API_KEY: string;
  INGEST_SECRET: string;
  SESSION_SECRET: string;
  DASHBOARD_PASSWORD: string;
}

// Udostępnia Astro.locals.runtime.env.DB oraz Astro.locals.runtime.env.GEMINI_API_KEY
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
