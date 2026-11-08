import { Session } from "./Session.ts";

/**
 * CORS, the same switch in every adapter (spec/auth_cases.json):
 *   CORS          off (default): no other site may call the API with cookies.
 *                 on (or true, 1, yes): other sites may.
 *   CORS_ORIGINS  with CORS on, only these origins (comma separated);
 *                 empty: any origin (development).
 * Same-origin setups (frontend and /api behind one host) need neither.
 */
export function corsSetting(
  on = Deno.env.get("CORS") ?? "",
  origins = Deno.env.get("CORS_ORIGINS") ?? "",
): { enabled: boolean; origins: string[] } {
  return {
    enabled: ["on", "true", "1", "yes"].includes(on.trim().toLowerCase()),
    origins: origins.split(",").map((o) => o.trim()).filter((o) => o !== ""),
  };
}

/** CORS headers for origin: none when CORS is off or the origin isn't allowed. */
export function getCorsHeaders(
  origin?: string,
  setting = corsSetting(),
): Record<string, string> {
  if (
    !setting.enabled || !origin ||
    (setting.origins.length > 0 && !setting.origins.includes(origin))
  ) {
    return { "Vary": "Origin" };
  }
  return {
    "Vary": "Origin",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

export class response {
  static JSON(
    body: any,
    session?: Session,
    status?: number,
    header?: Record<string, string | null>,
  ): Response {
    const origin = session?.req.headers.get("origin") || undefined;
    const cookieHeader = session?.returnCookie?.();
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...getCorsHeaders(origin),
        ...header,
        ...(cookieHeader ?? {}),
      },
    });
  }
  static JSONS(
    body: any,
    session?: Session,
    status?: number,
    header?: Record<string, string | null>,
  ): Response {
    const origin = session?.req.headers.get("origin") || undefined;
    const cookieHeader = session?.reactiveSession().returnCookie?.();
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...getCorsHeaders(origin),
        ...header,
        ...(cookieHeader ?? {}),
      },
    });
  }
  static async JSONF(
    body: any,
    header: Record<string, string | null> = {},
    status?: number,
    req?: Request,
  ): Promise<Response> {
    const origin = req?.headers.get("origin") || undefined;
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...getCorsHeaders(origin),
        ...header,
      },
    });
  }
  static OPTIONS(req: Request): Response {
    const origin = req.headers.get("origin") || undefined;
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }
}
