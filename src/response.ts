export class response {
  static async JSON200(req: any): Promise<Response> {
    return await new Response(JSON.stringify(req), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
  static async JSON404(req: any): Promise<Response> {
    return await new Response(JSON.stringify(req), {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
  static async JSON403(req: any): Promise<Response> {
    return await new Response(JSON.stringify(req), {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
}
