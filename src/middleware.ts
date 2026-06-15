import { defineMiddleware } from "astro:middleware";
import { verifySession } from "./lib/auth";

/** Ścieżki zawsze publiczne — nie wymagają sesji. */
function isPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/ingest/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_astro/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/styles/")
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isPublic(pathname)) return next();

  const env = context.locals.runtime.env;
  const cookie = context.cookies.get("session")?.value;
  const valid = await verifySession(cookie, env);

  if (valid) return next();

  if (pathname.startsWith("/api/")) {
    return new Response("Unauthorized", { status: 401 });
  }

  return context.redirect("/login", 302);
});
