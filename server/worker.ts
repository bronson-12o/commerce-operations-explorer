import { neon } from "@neondatabase/serverless";
import { makeApp, CSP, type Bindings } from "./app";
declare const __HTML_PAGES__: Record<string, string>;
const app = makeApp((env) => {
  if (!env.DATABASE_URL) throw new Error("Database is not configured");
  const sql = neon(env.DATABASE_URL);
  return {
    query: async (text, values = []) =>
      (await sql.query(text, values, {
        fetchOptions: { signal: AbortSignal.timeout(10000) },
      })) as Record<string, unknown>[],
  };
});
export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url);
    let result: Response;
    if (url.pathname.startsWith("/api/"))
      result = await app.fetch(request, env);
    else if (Object.hasOwn(__HTML_PAGES__, url.pathname))
      result = new Response(__HTML_PAGES__[url.pathname], {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    else if (env.ASSETS) result = await env.ASSETS.fetch(request);
    else result = new Response("Page not found", { status: 404 });
    const response = new Response(result.body, result);
    response.headers.set("Content-Security-Policy", CSP);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    return response;
  },
};
