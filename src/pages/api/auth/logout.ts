import type { APIRoute } from "astro";

export const POST: APIRoute = ({ cookies, redirect }) => {
  cookies.delete("session", { path: "/" });
  return redirect("/login", 302);
};
