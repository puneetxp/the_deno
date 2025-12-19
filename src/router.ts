import { _Routes, guard, Route, Route_Group_with, Routes } from "./type.ts";
import { response } from "./response.ts";
import { intersect, mergeObject } from "./thefun.ts";
import { Session } from "./Session.ts";
import { getCookies } from "../deps.ts";
const host = Deno.env.get("HOST");

export class Router {
  constructor(public routes_list: Routes, public req: Request) {}
  params: string[] | URLPatternResult = [];
  route: null | Route = null;

  async run(): Promise<Response> {
    if (this.route) {
      return await this.checkPermission();
    }
    return await response.JSONF("Not Found", {}, 404, this.req);
  }

  async checkPermission(): Promise<Response> {
    try {
      if (this.route?.islogin) {
        const login = await this.login(this.route);
        if (login.islogin) {
          if (login.active_session) {
            return await this.route.handler(
              login.active_session,
              this.params,
            );
          } else {
            return await response.JSONF(
              "Session Error",
              {},
              401,
              this.req,
            );
          }
        } else {
          return await response.JSONF(
            login.error,
            {},
            401,
            this.req,
          );
        }
      }
      return await this.route?.handler(new Session(this.req), this.params) ||
        await response.JSONF("Handler not found", {}, 500, this.req);
    } catch (error) {
      // Log the error to help with debugging
      const timestamp = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const url = this.req.url;
      
      console.error(`${timestamp}`);
      console.error(url);
      console.error(`[HANDLER ERROR] ${errorMessage}`);
      
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      } else {
        console.error(error);
      }
      
      // Return a 500 error response instead of crashing
      return await response.JSONF(
        "An internal server error occurred. Please try again later.",
        {},
        500,
        this.req,
      );
    }
  }

  async login(
    route: Route,
  ): Promise<{ islogin: boolean; error: any; active_session?: Session }> {
    const cookie = getCookies(this.req.headers);
    if (cookie.PHPSESSID) {
      const active_session =
        (await new Session(this.req, cookie).validSession())
          .getLogin();
      if (active_session.Login) {
        if (route.guard) {
          for (const element of route.guard) {
            const E403 = await element(this.req);
            if (E403) {
              return { islogin: false, error: E403 };
            }
          }
        }
        if (route.roles) {
          if (
            intersect(active_session.Login.roles, route.roles) ==
              false
          ) {
            return {
              islogin: false,
              error: "Your role is limited",
            };
          }
        }
        return {
          islogin: true,
          error: null,
          active_session: active_session,
        };
      }
    }
    return {
      islogin: false,
      error: "PLease Login First",
    };
  }

  URLPattern(): this {
    for (const r of this.routes_list[this.req.method]) {
      const match = r.route?.exec(this.req.url);
      if (match != null) {
        this.route = r;
        this.params = match;
      }
    }
    return this;
  }

  regExCheck(req: Request): this {
    const relativepath = req.url.replace(
      new RegExp(".*" + req.headers.get("host")),
      "",
    );

    const r = this.routes_list[req.method].find((i) => {
      return (
        i.path.split("/").length == relativepath.split("/").length &&
        relativepath.match(`${i.path}$`)
      );
    });
    if (r) {
      const pathparam = relativepath.split("/");
      const params: string[] = [];
      r?.path.split("/").forEach((e, key) => {
        if (e == ".+") {
          params.push(pathparam[key]);
        }
      });
      this.params = params;
    }
    return this;
  }
}
export function compile_url_pattern(x: Routes): Routes {
  Object.keys(x).forEach(
    (y) => {
      x[y] = x[y].map((i) => {
        i.route = new URLPattern(
          { pathname: i.path },
        );
        return i;
      });
    },
  );
  return x;
}
export function compile_routes(route_pre: _Routes): Routes {
  const route: Routes = {};
  for (const e of route_pre) {
    mergeObject(route, compile_route(e) || {});
  }
  return route_path_clean(route);
}
function compile_route(route: Route_Group_with): Routes | undefined {
  const routes: Routes = {};
  if (route.handler) {
    const x: Routes = {};
    if (!route.method) {
      route.method = "GET";
    }
    if (!x[route.method]) {
      x[route.method] = [];
    }
    x[route.method] = [
      ...x[route.method],
      ...[
        {
          path: route.path || "",
          handler: route.handler,
          ...(route.guard && { guard: route.guard }),
          ...(route.roles && { roles: route.roles }),
          ...(route.islogin && { islogin: route.islogin }),
        },
      ],
    ];
    return x;
  }
  if (route.group) {
    mergeObject(
      routes,
      compile_group(
        route.group,
        route.path,
        route.islogin,
        route.roles,
        route.guard,
      ),
    );
  }
  if (route.child) {
    mergeObject(
      routes,
      child_route(
        route.child,
        route.path,
        route.islogin,
        route.roles,
        route.guard,
      ),
    );
  }
  if (route.crud) {
    mergeObject(
      routes,
      crud(
        route.crud,
        route.path,
        route.islogin,
        route.roles,
        route.guard,
      ),
    );
  }
  return routes;
}
function crud(
  crud: any,
  path?: string,
  islogin?: boolean,
  roles?: string[],
  guard?: guard[],
) {
  return compile_group(
    {
      GET: [
        ...crud.crud.includes("a") &&
            [{ path: "", handler: crud.class.all }] || [],
        ...crud.crud.includes("r") &&
            [{ path: "/:id", handler: crud.class.show }] || [],
      ],
      POST: [
        ...crud.crud.includes("c") &&
            [{ path: "", handler: crud.class.store }] || [],
        ...crud.crud.includes("w") &&
            [{ path: "/where", handler: crud.class.where }] || [],
        ...crud.crud.includes("u") &&
            [{ path: "/:id", handler: crud.class.update }] || [],
      ],
      PATCH: [
        ...crud.crud.includes("p") &&
            [{ path: "", handler: crud.class.upsert }] || [],
      ],
      DELETE: [
        ...crud.crud.includes("d") &&
            [{ path: "/:id", handler: crud.class.delete }] || [],
      ],
    },
    path,
    islogin,
    roles,
    guard,
  );
}
function route_path_clean(route: Routes) {
  for (const [key] of Object.entries(route)) {
    route[key].forEach((i, index) => {
      if (route[key][index].path != "/") {
        route[key][index].path = route[key][index].path.replace(
          new RegExp("\/$"),
          "",
        ).replace("", "/").replace("//", "/").replace("//", "/");
      }
    });
  }
  return route;
}
function child_route(
  route: Route_Group_with[],
  path?: string,
  islogin?: boolean,
  roles?: string[],
  guard?: guard[],
): Routes {
  const x: Routes = {};
  for (const e of route) {
    mergeObject(
      x,
      compile_route({
        path: (path || "") + (e.path || ""),
        method: e.method || "GET",
        handler: e.handler,
        ...(guard
          ? (e.guard ? { guard: [...guard, ...e.guard] } : { guard })
          : (e.guard ? { guard: [...e.guard] } : undefined)),
        ...(roles
          ? (e.roles ? { roles: [...roles, ...e.roles] } : { roles })
          : (e.roles ? { roles: [...e.roles] } : undefined)),
        ...((e.islogin && { islogin: e.islogin }) ||
          (islogin && { islogin })),
        crud: e.crud,
        child: e.child,
        group: e.group,
      }) || {},
    );
  }
  return x;
}
function compile_group(
  group: Record<string, Route_Group_with[]>,
  path?: string,
  islogin?: boolean,
  roles?: string[],
  guard?: guard[],
) {
  const route: Routes = {};
  for (const [key, value] of Object.entries(group)) {
    for (const e of value) {
      if (e.handler) {
        route[key] = [...route[key] || [], {
          path: path + (e.path || ""),
          handler: e.handler,
          ...(guard
            ? (e.guard ? { guard: [...guard, ...e.guard] } : { guard })
            : undefined),
          ...(roles
            ? (e.roles ? { roles: [...roles, ...e.roles] } : { roles })
            : undefined),
          ...((e.islogin && { islogin: e.islogin }) ||
            (islogin && { islogin })),
        }];
      }
    }
  }
  return route;
}
