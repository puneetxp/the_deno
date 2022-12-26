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
  { path: "/logout", method: "GET", handler: AuthController.Login, guard: [AuthGuard] },
  { path: "/register", method: "POST", handler: AuthController.Register },
]
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

## Guard are async function

if there is string it will return string as error 403.

```ts
guard?: () => Promise<false | string>;
```
