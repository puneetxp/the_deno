## Early Stages Please report any error.

Let See Example

```ts
import { compile_routes, response, Router } from "jsr:@puneetxp/the@0.1.0";
const _routes = [{
  path: "/checlk",
  handler: () => response.JSON("s"),
}, {
  path: "/checldk",
  method: "POST",
  handler: () => response.JSON("s"),
}];
const routes = compile_routes(_route);
Deno.serve(
  { port: 3333 },
  async (req: Request): Promise<Response> => {
    return await new Router(routes).route(req);
  },
);
```

If there is Method not present it get default to GET. If path is not there it
will assume it is empty.

## Data pass

It is hardcore just _**/.+**_ where you need you get in pramas

#### in route

```ts
const _routes = [{
  path: "/.+",
  handler: () => handler,
}];
```

#### in handler

You get params as array and you can get by _**params[0]**_ , _**parmas[1]**_

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
} from "jsr:@puneetxp/the@0.1.0";
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

Method default is "GET" and path is "". So if you leave it blank you should know
what you will get.

## Other Parameters

For Netested child / group / crud can use.

For Permission Guard , roles and islogin can used

### Handler

We have two type of handler first for restrictive route and secound for public.
with params

```ts
// raw request passto handler
export type CallbackHandler = (
  request: Request,
  params: any[],
) => Promise<Response>;
// Session pass to handler
export type CallbackHandlerLogin = (
  session: Session,
  params: any[],
) => Promise<Response>;
```

### Islogin

_**islogin**_ default is _**false**_ if your route is login protected you should
put

```ts
{ path: "/login", handler: AuthController.Status, islogin: true },
{ path: "/login", method: "POST", handler: AuthController.Login },
{ path: "/logout", method: "GET", handler: AuthController.Logout, islogin: true },
{ path: "/register", method: "POST", handler: AuthController.Register },
```

when islogin is true we first check for cookie and if it is in session pass to
handler. if not _**Error 401**_

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
['c','r','u','d','a','w','p'] 

c for create
r for read
u for update
d for delete
a for read all
w for read where
p is add in bulk
```

```ts
const user = {
  path: "/user",
  guard: [AuthGuard],
  class: UserController,
  crud: ["c", "r", "u", "d", "a", "w", "p"],
};
```

it is usuall work like

```ts
{
  GET: [
    ...user.crud.includes("a") &&
        [{ path: "", handler: user.class.all }] || [],
    ...user.crud.includes("r") &&
        [{ path: "/.+", handler: user.class.show }] || [],
  ],
  POST: [
    ...user.crud.includes("c") &&
        [{ path: "", handler: user.class.store }] || [],
    ...user.crud.includes("w") &&
        [{ path: "where", handler: user.class.where }] || [],
    ...user.crud.includes("u") &&
        [{ path: "/.+", handler: user.class.update }] || [],
  ],
  PATCH: [
    ...user.crud.includes("p") &&
        [{ path: "", handler: user.class.upsert }] || [],
  ],
  DELETE: [
    ...crud.crud.includes("d") &&
    [{ path: "/.+", handler: crud.class.delete }] || []
  ]
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

## Database: MySQL or PostgreSQL

The connection comes from environment variables (`.env` is loaded):

| Variable                    | Meaning                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `DBDRIVER`                  | `mysql` (default; also `mariadb`) or `postgres` (also `postgresql`, `pg`) |
| `DBHOST`                    | Server host                                                               |
| `DBPORT`                    | Port; default `3306` for MySQL, `5432` for PostgreSQL                     |
| `DBSOCKET`                  | MySQL: socket file (auto-detected). PostgreSQL: socket directory          |
| `DBUSER`, `DBPWD`, `DBNAME` | Credentials and database                                                  |
| `DBPOOL`                    | Pool size, default `4`                                                    |
| `DBSSL`, `DBSSL_CA`         | MySQL: `DBSSL=on` for TLS over TCP; `DBSSL_CA` is a CA file (PEM)         |
| `MYSQL_CLIENT`              | `native` (default) or `mysql2` to use `npm:mysql2` instead                |

The pool is opened on the first query. `npm:pg` is loaded only when
`DBDRIVER=postgres`.

### The built-in MySQL/MariaDB client

MySQL and MariaDB are reached through `src/mysql/`, a client written in
TypeScript on Deno's TCP/TLS and Web Crypto, with no npm packages. It covers
what the model layer needs: a pool, `query(sql, values)` and `end()`. It formats
`?`/`??` placeholders and returns rows, `{ insertId, affectedRows }` and errors
(`code`, `errno`, `sqlState`) as mysql2 did, so `MYSQL_CLIENT=mysql2` switches
back without other changes.

- Logins: `mysql_native_password`, `caching_sha2_password` (MySQL 8; the RSA key
  exchange when there is no TLS), `sha256_password`, and `mysql_clear_password`
  over TLS or a socket only. MariaDB's `ed25519` and `parsec` are not supported.
- Values: integers come back as numbers, and BIGINT past 2^53 as an exact
  string; DECIMAL as a string; DATE/DATETIME/TIMESTAMP as local-time `Date`s
  (zero dates as an invalid `Date`, which is `null` in JSON); binary and BIT as
  `Uint8Array`; MySQL's JSON type parsed.
- A connection that the server closes while idle is dropped before reuse, and a
  query that finds its connection broken before sending moves to another one.
  Nothing that may have reached the server is retried.

Measured against mysql2 on MariaDB 11.8 (the same Deno, 4 connections), the
built-in client starts in about 20 ms instead of about 900 ms, uses about 25 MB
less memory, and is faster on single-row queries and inserts (6,100/s against
4,500/s with 4 running at once). 1000-row selects are level with mysql2.

Queries are written once, MySQL-style: `?` placeholders and backtick-quoted
identifiers, in the builder and in `raw()` SQL alike. On PostgreSQL they are
rewritten right before running: `?` becomes `$1, $2, ...` and backticks become
double quotes. Text inside strings and comments is left alone, and SQL that
already uses `$n` is passed through unchanged.

On PostgreSQL:

- inserts add `RETURNING *`, so `create()`, `lastinsert()` and `lastinserts()`
  work without `insertId`;
- `upsert()` becomes `ON CONFLICT (id) DO UPDATE SET col = EXCLUDED.col`. MySQL
  matches any unique key, while PostgreSQL needs one named; pass another key
  with `db.UpsertQ(rows, ["book_id", "number"])`;
- `bigint`/`bigserial` come back as numbers, as they do from mysql2.
  `numeric`/`decimal` stay strings in both drivers;
- INSERT/UPDATE/DELETE results have the same shape as MySQL's:
  `{ insertId, affectedRows }`;
- `count(*)` comes back under the key `count`, not `count(*)`.

Not translated: MySQL-only functions and syntax in `raw()` SQL, such as
`IFNULL`, `DATE_FORMAT`, `ON DUPLICATE KEY` or `LIMIT` on UPDATE. Write those
portably, for example `COALESCE` instead of `IFNULL`. `toggle()` works on 0/1
integer flag columns (as compile-php generates `enable`) on both.

Tests: `deno test -A src/` runs the SQL rewrite tests. To also run the Model/DB
test against a real server, which creates and drops `the_pg_items` and
`the_pg_categories`:

```sh
DBTEST=1 DBDRIVER=postgres DBHOST=127.0.0.1 DBUSER=postgres DBNAME=the_test deno test -A src/
DBTEST=1 DBHOST=127.0.0.1 DBUSER=root DBNAME=the_test deno test -A --unstable-kv src/
```

The MySQL client's own tests (`src/mysql/mysql_test.ts`) use the same variables
and create and drop `the_my_t` and the procedure `the_my_p`.

## Passwords and CORS (the same in every adapter)

`spec/auth_cases.json` holds the cases for both. The file is the same in
the_deno, the_lib and the_go, and each adapter's tests read it.

**Passwords:** bcrypt, cost 10. A hash made by any adapter logs in through the
others.

- Old unsalted SHA3-256 hashes (the_deno base64, the_lib hex) still log in, and
  are replaced by bcrypt at that login.
- Any length works: bcrypt reads only 72 bytes, so a password over 72 bytes is
  first reduced to base64(SHA3-256(password)), 44 characters. Every byte counts
  (a long Hindi passphrase is fine), and the stored hash is still a plain bcrypt
  string.
- A new password must have 6 to 128 characters (Unicode characters, not bytes).
  The messages, "Password must be at least 6 characters" and "Password is too
  long", say nothing about how passwords are stored.

**CORS:** a switch, off by default.

| Setting                                                   | Effect                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CORS` unset or `off`                                     | no other site may call the API with cookies; same-origin setups need nothing |
| `CORS=on`                                                 | other sites may: any origin, for development                                 |
| `CORS=on` with `CORS_ORIGINS=https://a.com,https://b.com` | only those origins, for production                                           |

In Deno: `hashPassword` and `verifyPassword` (from `mod.ts`), and `CORS` /
`CORS_ORIGINS` in the environment. The router now answers CORS preflights.
Before, an `OPTIONS` request crashed the handler.

## Querying through models

Build queries as a chain on the model; relations are used by name:

```ts
await Book_stock$()
  .where({ publish: 1, enable: 1 })
  .whereHas("book", { public_listing: 1 })
  .whereHas("product", (p) => p.where({ enable: 1 }))
  .orderBy("id")
  .get();
```

Also `whereNotHas`, `limit(count, offset)`, `withJoin([rel])` (uses the chain)
and `toSQL()`. The full contract, which every language adapter follows, is in
[`spec/README.md`](spec/README.md), with test cases in `spec/query_cases.json`.

## Model and update

Documentation Update Soon Example as below

Model

```ts
import { Model } from "../../repo/Model.ts";
import { relation } from "../../repo/type.ts";
import { Account_attribute$ } from "./Account_attribute.ts";
import { Account$ } from "./Account.ts";

class Standard extends Model {
  name = "account_attribute_value";
  table = "account_attribute_values";
  nullable: string[] = ["id"];
  fillable: string[] = ["name", "enable", "account_attribute_id", "account_id"];
  model: string[] = [
    "name",
    "enable",
    "id",
    "created_at",
    "updated_at",
    "account_attribute_id",
    "account_id",
  ];
  relationship: Record<string, relation> = {
    "account_attribute": {
      "table": "account_attributes",
      "name": "account_attribute_id",
      "key": "id",
      "callback": () => Account_attribute$,
    },
    "account": {
      "table": "accounts",
      "name": "account_id",
      "key": "id",
      "callback": () => Account$,
    },
  };
}
export const Account_attribute_value$: Standard = new Standard().set(
  "account_attribute_values",
);
```

Controller

```ts
import { response } from "../../../repo/response.ts";
import { Session } from "../../../repo/Session.ts";
import { Account_attribute_value$ } from "../../Model/Account_attribute_value.ts";
export class SuperAccount_attribute_valueController {
  static async all(session: Session) {
    const account_attribute_value = await Account_attribute_value$.all().Item;
    return response.JSON({ account_attribute_value }, session);
  }
  static async where(session: Session) {
    const req = await Account_attribute_value$.where(await session.req.json())
      .Item;
    return response.JSON({ req }, session);
  }
  static async show(session: Session, param: string[]) {
    const req = await Account_attribute_value$.find(param[0].toString()).Item;
    return response.JSON({ req }, session);
  }
  static async store(session: Session) {
    const account_attribute_value = await Account_attribute_value$.create([
      await session.req.json(),
    ]);
    return response.JSON({ account_attribute_value }, session);
  }
  static async update(session: Session, param: string[]) {
    const account_attribute_value = await Account_attribute_value$.update(
      [{ id: [param[0]] }],
      await session.req.json(),
    );
    return response.JSON({ account_attribute_value }, session);
  }
  static async upsert(session: Session) {
    const account_attribute_value = await Account_attribute_value$.create(
      await session.req.json(),
    );
    return response.JSON({ account_attribute_value }, session);
  }
  static async delete(session: Session, param: string[]) {
    const account_attribute_value = await Account_attribute_value$.del([{
      col: "id",
      value: [param[0]],
    }]);
    return response.JSON({ account_attribute_value }, session);
  }
}
```

## benchmark

This Framework can little hard but benefit in speed will unreal.

On Our Framework

Routing session and auth are good but testing is still lacking we are in still
alpha

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
  188770 requests in 10.10s, 46.94MB read
Requests/sec:  17402.96
Transfer/sec:      4.65MB
```

Usually 33%++ faster then Oak
