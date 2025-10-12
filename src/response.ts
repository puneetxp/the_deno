import { Session } from "./Session.ts";

// Helper to get CORS headers
function getCorsHeaders(origin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
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
  ) {
    const origin = session?.req.headers.get("origin") || undefined;
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...getCorsHeaders(origin),
        ...header,
        ...(session && session.returnCookie()),
      },
    });
  }
  static JSONS(
    body: any,
    session?: Session,
    status?: number,
    header?: Record<string, string | null>,
  ) {
    const origin = session?.req.headers.get("origin") || undefined;
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...getCorsHeaders(origin),
        ...header,
        ...(session && session.reactiveSession().returnCookie()),
      },
    });
  }
  static async JSONF(
    body: any,
    header: Record<string, string | null> = {},
    status?: number,
    req?: Request,
  ) {
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
  static OPTIONS(req: Request) {
    const origin = req.headers.get("origin") || "*";
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }
}
