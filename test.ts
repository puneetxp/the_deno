import { _Routes, compile_routes, response, Router } from "./mod.ts";
const _routes: _Routes = [{
  path: "/",
  handler: async () => await response.JSON("s"),
}, {
  path: "/checldk",
  method: "POST",
  handler: async () => await response.JSON("s"),
}];
const routes = compile_routes(_routes);
Deno.serve(
  { port: 9000 },
  async (req: Request): Promise<Response> => {
    return await new Router(routes).route(req);
  }
);