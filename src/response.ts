import { Session } from "./Session.ts";
export class response {
  static JSON(
    body: any,
    session?: Session,
    status?: number,
    header?: Record<string, string | null>,
  ) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
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
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...header,
        ...(session && session.reactiveSession().returnCookie()),
      },
    });
  }
  static async JSONF(
    body: any,
    header: Record<string, string | null> = {},
    status?: number,
  ) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...header,
      },
    });
  }
}
