## Start

On Our Frameset

```bash
Running 10s test @ http://localhost:3333
  2 threads and 10 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency   397.97us  497.73us   9.72ms   97.06%
    Req/Sec    14.48k     1.00k   16.18k    78.50%
  288023 requests in 10.00s, 39.00MB read
Requests/sec:  28800.79
Transfer/sec:      3.90MB
```

When oak

```bash
Running 10s test @ http://localhost:8080/
  2 threads and 10 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency   633.04us    0.98ms  31.01ms   97.65%
    Req/Sec     8.79k     1.34k   14.73k    91.54%
  175770 requests in 10.10s, 46.94MB read
Requests/sec:  17402.96
Transfer/sec:      4.65MB
```

Usually 33%++ faster then Oak

Let See Example

```ts
import {
  compile_route,
  response,
  routes,
} from "https://deno.land/x/the@0.0.0.1/mod.ts";
import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
const _routes = [{
  path: "/checlk",
  handler: () => response.JSON200("s"),
}, {
  path: "/checldk",
  method: "POST",
  handler: () => response.JSON200("s"),
}];
const routes = compile_route(_route);
serve(
  async (req: Request): Promise<Response> => {
    return await new Router(routes).route(req);
  },
  { port: 3333 },
);
```

If there is Method not present it get default to GET.

## Response

Every Controller should return new Response.

```ts
(() => response.JSON200("s"));
```

## Router

When I am trying to using URLPattern I see such a performace hit so it seem
right choice is to create some light router faster then anyone.

It have Guard and a Router Config file

## Config file

GET POST AND OTHER ARE SEPRATED. For Netested child can use.

```ts
import { response } from "../../repo/response.ts";
import { compile_route } from "../../repo/router.ts";
import { _Routes } from "../../repo/Type.ts";
export const _routes: _Routes = [
  {
    path: "/text",
    child: [
      {
        path: "/checlk",
        handler: () => response.JSON200("s"),
      },
      {
        path: "/checldk",
        method:"POST",
        handler: () => response.JSON200("s"),
      }];
  },
  { path: "/login", method: "GET", handler: AuthController.Status },
  { path: "/login", method: "POST", handler: AuthController.Login },
  { path: "/logout", method: "GET", handler: AuthController.Login },
  { path: "/register", method: "POST", handler: AuthController.Register },
]
```

## Guard

### Guard are async function

if there is string it will return string as error 403.

```ts
guard?: () => Promise<false | string>;
```

#### Guard function

```ts
export const AuthGuard = async (): Promise<false | string> => {
  return await "Not Assesbile";
};
```

#### We Can use it like

```ts
import { response } from "../../repo/response.ts";
import { compile_route } from "../../repo/router.ts";
import { _Routes } from "../../repo/Type.ts";
export const _routes: _Routes = [
  {
    path: "/login",
    method: "GET",
    handler: AuthController.Status,
    guard: [AuthGuard],
  },
];
```

### We can create a Group for curd

This is just a Group with CRUD functionallity but can used as desired

```ts
const user = [
  {
    path: "/user",
    guard: [AuthGuard],
    group: {
      GET: [
        { path: "", handler: UserController.all, guard: [AdminGuard] },
        { path: "/.+", handler: UserController.show },
      ],
      POST: [
        { path: "", handler: UserController.store },
        { path: "/.+", handler: UserController.update },
      ],
      PATCH: [{ path: "", handler: UserController.upsert }],
      DELETE: [{ path: "/.+", handler: UserController.delete }],
    },
  },
];
```

### Shorthand for crud.

```ts
const user = { path: "/user", guard: [AuthGuard], crud: UserController };
```

### It compile with compile_route()

```ts
export const routes = compile_route(_routes);
```

#### So basically it is record

```ts
export type Routes = Record<string, Route[]>;
```
