import {
  _Routes,
  guard,
  isCallbackHandler,
  isCallbackHandlerLogin,
  Route,
  Route_Group_with,
  Routes,
} from "./type.ts";
import { response } from "./response.ts";
import "https://deno.land/std@0.173.0/dotenv/load.ts";
import { intersect, mergeObject } from "./thefun.ts";
import { Session } from "./Session.ts";
import { getCookies } from "https://deno.land/std@0.173.0/http/cookie.ts";

//this is moduler and almost same performce
export class Router {
  constructor(public routes_list: Record<string, Route[]>) {}
  async route(req: Request): Promise<Response> {
    const relativepath = req.url.replace(
      new RegExp(".*" + req.headers.get("host")),
      "",
    );
    const pathparam = relativepath.split("/");
    const r = this.routes_list[req.method].find((i) => {
      return (
        i.path.split("/").length == relativepath.split("/").length &&
        relativepath.match(`${i.path}$`)
      );
    });
    if (r) {
      const params: any[] = [];
      r.path.split("/").forEach((e, key) => {
        if (e == ".+") {
          params.push(pathparam[key]);
        }
      });
      if (r.islogin) {
        const cookie = getCookies(req.headers);
        if (cookie.PHPSESSID) {
          const active_session = new Session(req, cookie).setLogin();
          if (active_session.Login) {
            if (r.guard) {
              for (const element of r.guard) {
                const E403 = await element(req);
                if (E403) {
                  return response.JSON(E403, active_session, 403);
                }
              }
            }
            if (r.roles) {
              if (intersect(active_session.Login.roles, r.roles) == false) {
                return response.JSON(
                  "Your Role is Limited",
                  active_session,
                  403,
                );
              }
            }
            if (isCallbackHandlerLogin(r.handler)) {
              return await r.handler(active_session, params);
            }
          }
        }
        return await response.JSON("Please Login First", undefined, 401);
      } else {
        if (isCallbackHandler(r.handler)) {
          return await r.handler(req, params);
        }
      }
    }
    return await response.JSON("Not Found");
  }
}
export function compile_routes(route_pre: _Routes): Routes {
  let route: Routes = {};
  for (const e of route_pre) {
    mergeObject(route, compile_route(e) || {});
  }
  return route_path_clean(route);
}
function compile_route(route: Route_Group_with): Routes | undefined {
  if (route.group) {
    return compile_group(
      route.group,
      route.path,
      route.islogin,
      route.roles,
      route.guard,
    );
  }
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
  if (route.child) {
    return child_route(
      route.child,
      route.path,
      route.islogin,
      route.roles,
      route.guard,
    );
  }
  if (route.crud) {
    return crud(
      route.crud,
      route.path,
      route.islogin,
      route.roles,
      route.guard,
    );
  }
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
        ...crud.crud.includes("all") &&
            [{ path: "", handler: crud.class.all }] || [],
        ...crud.crud.includes("r") &&
            [{ path: "/.+", handler: crud.class.show }] || [],
      ],
      POST: [
        ...crud.crud.includes("c") &&
            [{ path: "", handler: crud.class.store }] || [],
        ...crud.crud.includes("u") &&
            [{ path: "/.+", handler: crud.class.update }] || [],
      ],
      PATCH: [
        ...crud.crud.includes("upsert") &&
            [{ path: "", handler: crud.class.upsert }] || [],
      ],
      WHERE: [
        ...crud.crud.includes("where") &&
            [{ path: "", handler: crud.class.where }] || [],
      ],
      ...crud.crud.includes("d") &&
          { DELETE: [{ path: "/.+", handler: crud.class.delete }] } || {},
    },
    path,
    islogin,
    roles,
    guard,
  );
}
function route_path_clean(route: Routes) {
  for (const [key, value] of Object.entries(route)) {
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
  let x: Routes = {};
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
