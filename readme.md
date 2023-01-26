## Early Stages Please report any error.

Let See Example

```ts
import {
  compile_routes,
  response,
  Router,
} from "https://deno.land/x/the@0.0.0.4.3/mod.ts";
import { serve } from "https://deno.land/std@0.173.0/http/server.ts";
const _routes = [{
  path: "/checlk",
  handler: () => response.JSON("s"),
}, {
  path: "/checldk",
  method: "POST",
  handler: () => response.JSON("s"),
}];
const routes = compile_routes(_route);
serve(
  async (req: Request): Promise<Response> => {
    return await new Router(routes).route(req);
  },
  { port: 3333 },
);
```

If there is Method not present it get default to GET. If path is not there it
will assume it is empty.

## Data pass

It is hardcore just ***/.+*** where you need you get in pramas
#### in route
```ts
const _routes = [{
  path: "/.+",
  handler: () => handler,
}];

```
#### in handler

You get params as array and you can get by ***params[0]*** , ***parmas[1]***
```ts
handler(req:Request, params :any[]){
  params[0];
}
```
## Response

Every Controller should return new Response.

```ts
(() => response.JSON("s"));
```

### Response Class

```ts
import { Session } from "./Session.ts";
export class response {
  //JSON return a Json response with session regenrate the cookie id 
  //and set new cookie. as old one exipre after a request.
  static async JSON(
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

  //JSONF return header and status with body
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
```



## Router

When I am trying to using URLPattern I see such a performace hit so it seem
right choice is to create some light router faster then anyone.

It have Guard and a Router Config file

## Config file

First Check little simple route
```ts
import {
  compile_routes,
  response,
  Router,
} from "https://deno.land/x/the@0.0.0.4.3/mod.ts";
export const _routes: _Routes = [
  {
    path: "/text",
    child: [
      {
        path: "/",
        handler: () => response.JSONF("GET"),
      },
      {
        method:"POST",
        handler: () => response.JSONF("POST"),
      }];
  }
]
```

## Default

Method default is "GET" and path is "".
So if you leave it blank you should know what you will get.

## Other Parameters

For Netested child / group / crud can use. 

For Permission Guard , roles and islogin can used
### Handler
We have two type of handler first for restrictive route and secound for public. with params
```ts
// raw request passto handler
export type CallbackHandler = (
  request: Request,
  params: any[],
) => Promise<Response>;
// Session pass to handler
export type CallbackHandlerLogin = (
  session: Session,
  params: any[]
) => Promise<Response>;
```

### Islogin
***islogin*** default is ***false***
if your route is login protected you should put
```ts
  { path: "/login", handler: AuthController.Status, islogin: true },
  { path: "/login", method: "POST", handler: AuthController.Login },
  { path: "/logout", method: "GET", handler: AuthController.Logout, islogin: true },
  { path: "/register", method: "POST", handler: AuthController.Register },
```
when islogin is true we first check for cookie and if it is in session pass to handler. if not ***Error 401***

### Guard
You need to add Islogin to guard work.
#### Guard are async function

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
import { compile_routes } from "../../repo/router.ts";
import { _Routes } from "../../repo/Type.ts";
export const _routes: _Routes = [
  {
    islogin: true,
    path: "/login",
    method: "GET",
    handler: AuthController.Status,
    guard: [AuthGuard],
  },
];
```
### Role function
islogin need to true to function

```ts
  {
    islogin: true,
    path: "/login",
    roles:['manager'],
    child:[{
      roles:['isuper'],
      path:'/roles',
      handler: AuthController.Status
    }]
    guard: [AuthGuard],
  }
```
## Group

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

Crud has it meaning here is 
```bash
['c','r','u','d','all','where','upsert'] 

c for create
r for read
u for update
d for delete
all for read all
where for read where
upsert is add in bulk
```
```ts
const user = { 
  path: "/user", 
  guard: [AuthGuard], 
  class:UserController, 
  crud: ['c','r','u','d','all','where','upsert'] 
  };
```

it is usuall work like 
```ts
    {
      GET: [
        ...user.crud.includes("all") &&
            [{ path: "", handler: user.class.all }] || [],
        ...user.crud.includes("r") &&
            [{ path: "/.+", handler: user.class.show }] || [],
      ],
      POST: [
        ...user.crud.includes("c") &&
            [{ path: "", handler: user.class.store }] || [],
        ...user.crud.includes("u") &&
            [{ path: "/.+", handler: user.class.update }] || [],
      ],
      PATCH: [
        ...user.crud.includes("upsert") &&
            [{ path: "", handler: user.class.upsert }] || [],
      ],
      WHERE: [
        ...user.crud.includes("where") &&
            [{ path: "", handler: user.class.where }] || [],
      ],
      ...user.crud.includes("d") &&
          { DELETE: [{ path: "/.+", handler: user.class.delete }] } || {},
    },
```
Yes i made sin to create new Method where
### It compile with compile_routes()

```ts
export const routes = compile_routes(_routes);
```

#### So basically it is record

```ts
export type Routes = Record<string, Route[]>;
```

Router/Framework Flow


![deno router green](https://user-images.githubusercontent.com/19248561/214393928-a341f0ef-7647-43a7-850f-354a06aa1aa7.svg)



## Model and update


Documentation Update Soon Example as below

Model
```ts
import { Model } from '../../repo/Model.ts';
import { relation } from '../../repo/type.ts';
import { Account_attribute$ } from './Account_attribute.ts';
import { Account$ } from './Account.ts';

class Standard extends Model {
  name = 'account_attribute_value';
  table = 'account_attribute_values';
  nullable: string[] = ["id"];
  fillable: string[] = ['name','enable','account_attribute_id','account_id'];
  model: string[] = ["name","enable","id","created_at","updated_at","account_attribute_id","account_id"];
  relationship:  Record<string,  relation>  = {'account_attribute':{'table':'account_attributes','name':'account_attribute_id','key':'id','callback':()=>Account_attribute$},'account':{'table':'accounts','name':'account_id','key':'id','callback':()=>Account$}};
}
export const Account_attribute_value$: Standard = new Standard().set('account_attribute_values');
```

Controller
```ts
import { response } from "../../../repo/response.ts";
import { Session } from "../../../repo/Session.ts";
import { Account_attribute_value$ } from "../../Model/Account_attribute_value.ts";
export class SuperAccount_attribute_valueController {
   static async all(session: Session){
      const account_attribute_value = await Account_attribute_value$.all().Item;
      return response.JSON({ account_attribute_value }, session);
   }
   static async where(session: Session) {
      const req = await Account_attribute_value$.where(await session.req.json()).Item;
      return response.JSON({ req }, session);
   }
   static async show(session: Session, param: string[]) {
      const req= await Account_attribute_value$.find(param[0].toString()).Item;
      return response.JSON({req}, session);
   }
   static async store(session: Session){
      const account_attribute_value = await Account_attribute_value$.create([await session.req.json()]);
      return response.JSON({ account_attribute_value }, session);
   }
   static async update(session: Session, param: string[]) {
      const account_attribute_value = await Account_attribute_value$.update(
      [{ id: [param[0]] }],
      await session.req.json(),
      );
      return response.JSON({ account_attribute_value }, session);
   }
   static async upsert(session: Session){
      const account_attribute_value = await Account_attribute_value$.create(await session.req.json());
      return response.JSON({ account_attribute_value }, session);
   }
   static async delete(session: Session, param: string[]) {
      const account_attribute_value = await Account_attribute_value$.del([{ col: "id", value: [param[0]] }]);
      return response.JSON({ account_attribute_value }, session);
   }
}
```
## benchmark

This Framework can little hard but benefit in speed will unreal.

On Our Framework

Routing session and auth are good but testing is still lacking we are in still alpha

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

When Oak

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
