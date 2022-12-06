## Router

When I am trying to using URLPattern I see such a performace hit so it seem right choice is to create some light router faster then anyone.

It have Guard and a Router Config file

## Config file

GET POST AND OTHER ARE SEPRATED.

```ts
export const routes: Routes =
{
  GET: [{
    path: "/",
    handler: Public.Home,
  }, {
    path: "/login",
    handler: Auth.Login,
  }, {
    path: "/logout",
    handler: Auth.Login,
    guard: AuthGuard,
  }, {
    path: "/.+",
    handler: Auth.Login,
  }],
  POST: [{
    path: "/login",
    handler: Auth.Login,
  }, {
    path: "/register",
    handler: Auth.Register,
  }],
  PATCH: [{
    path: "/user/update",
    handler: Auth.UpdateProfile,
  }]
}
```
### So basically it is record

```ts
export type Routes = Record<string, Route[]>
```


## Guard are async function

if there is string it will return string as error 403.

```ts
guard?: () => Promise<false | string>;
```

