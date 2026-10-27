import { handleAsk, type AskEnv } from "./ask";
import { errorResponse } from "./errors";
import { durableUsage } from "./usage";

export { UsageCounter } from "./usage";

export interface Env extends AskEnv {
  ASSETS: Fetcher;
  USAGE: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/ask") {
      if (request.method !== "POST") return errorResponse("method_not_allowed", 405);
      return handleAsk(request, env, { usage: durableUsage(env.USAGE), now: () => new Date() });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
