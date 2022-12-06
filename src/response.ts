export class response {
  static async JSON200(req: object | null): Promise<Response> {
    return await new Response(JSON.stringify(req), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
  static async JSON404(req: object | null): Promise<Response> {
    return await new Response(JSON.stringify(req), {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
}
