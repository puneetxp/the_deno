import {
 compile_routes,
 response,
 Router
} from "./mod.ts";
import { serve } from "https://deno.land/std@0.173.0/http/server.ts";
const _routes = [{
 path: "/",
 handler: () => response.JSON("s"),
}, {
 path: "/checldk",
 method: "POST",
 handler: () => response.JSON("s"),
}];
const routes = compile_routes(_routes);
serve(
 async (req: Request): Promise<Response> => {
   return await new Router(routes).route(req);
 },
 { port: 3333 },
);