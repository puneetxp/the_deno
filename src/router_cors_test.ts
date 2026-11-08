// A CORS preflight (OPTIONS) is answered, never a crash; headers follow the
// CORS switch. Run with --unstable-kv (Session opens Deno KV).
import { assertEquals } from "jsr:@std/assert@1.0.8";
import { compile_routes, compile_url_pattern, Router } from "./router.ts";
import { response } from "./response.ts";

const routes = compile_url_pattern(compile_routes([
  { path: "/p", handler: (session) => Promise.resolve(response.JSON("p", session)) },
]));
const ask = (method: string) =>
  new Router(
    routes,
    new Request("http://x/p", {
      method,
      headers: { Origin: "https://a.example" },
    }),
  )
    .URLPattern().run();

Deno.test("preflight with CORS off: 204, no CORS headers", async () => {
  Deno.env.delete("CORS");
  const r = await ask("OPTIONS");
  assertEquals([r.status, r.headers.get("access-control-allow-origin")], [
    204,
    null,
  ]);
});

Deno.test("preflight with CORS on: 204 and the origin allowed", async () => {
  Deno.env.set("CORS", "on");
  try {
    const r = await ask("OPTIONS");
    assertEquals([r.status, r.headers.get("access-control-allow-origin")], [
      204,
      "https://a.example",
    ]);
    const g = await ask("GET");
    assertEquals(
      [g.status, g.headers.get("access-control-allow-credentials")],
      [200, "true"],
    );
  } finally {
    Deno.env.delete("CORS");
  }
});

Deno.test("a method with no routes is a 404, not a crash", async () => {
  assertEquals((await ask("HEAD")).status, 404);
});
