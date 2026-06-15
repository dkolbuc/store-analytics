import type { APIRoute } from "astro";
import { createSession } from "../../../lib/auth";

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const form = await request.formData();
  const password = form.get("password");

  const env = locals.runtime.env;

  if (typeof password !== "string" || password !== env.DASHBOARD_PASSWORD) {
    return redirect("/login?error=1", 302);
  }

  const sessionValue = await createSession(env);

  cookies.set("session", sessionValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return redirect("/", 302);
};
