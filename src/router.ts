import type {
  CallbackHandler,
  guard,
  Routes,
  _Routes,
  Route,
  Route_Group_with,
} from "./type.ts";
import { response } from "./response.ts";
import "https://deno.land/std@0.170.0/dotenv/load.ts";
import { mergeObject } from "./thefun.ts";

//this is moduler and almost same performce
export class Router {
  constructor(public routes_list: Record<string, Route[]>) {}
  async route(req: Request): Promise<Response> {
    const relativepath = req.url.replace(
      new RegExp(".*" + req.headers.get("host")),
      ""
    );
    const pathparam = relativepath.split("/");
    const r = this.routes_list[req.method].find((i) => {
      return (
        i.path.split("/").length == relativepath.split("/").length &&
        relativepath.match(`${i.path.replaceAll("/", "/")}$`)
      );
    });
    if (r) {
      if (r.guard) {
        for (const element of r.guard) {
          const E403 = await element();
          if (E403) {
            return response.JSON403({ E403 });
          }
        }
      }
      const params: any[] = [];
      r.path.split("/").forEach((e, key) => {
        if (e == ".+") {
          params.push(pathparam[key]);
        }
      });
      return await r.handler(req, params);
    }
    return await response.JSON404("Not Found");
  }
}
function child_route(
  path: string,
  route: Route_Group_with[],
  guard: guard[] = []
): Routes {
  let x: Routes = {};
  for (const e of route) {
    if (e.group) {
      x = mergeObject(x, compile_group(e.group, path));
    } else if (e.child) {
      if (e.guard) {
        x = mergeObject(
          x,
          child_route(path + e.path, e.child, [...guard, ...e.guard])
        );
      } else {
        x = mergeObject(x, child_route(path + e.path, e.child, guard));
      }
    } else {
      e.path = path + e.path;
      if (e.handler && e.method) {
        if (!e.method) {
          e.method = "GET";
        }
        if (e.guard) {
          x[e.method] = [
            ...(x[e.method] || []),
            {
              path: e.path,
              handler: e.handler,
              guard: e.guard,
            },
          ];
        } else {
          x[e.method] = [
            ...(x[e.method] || []),
            { path: e.path, handler: e.handler },
          ];
        }
      }
    }
  }
  return x;
}
function route_to_method(
  path: string,
  handler: CallbackHandler,
  guard?: guard[]
): Route {
  if (guard) {
    return { path: path, handler: handler, guard: guard };
  }
  return { path: path, handler: handler };
}
export function compile_route(route_pre: _Routes) {
  let route: Routes = {};
  for (const e of route_pre) {
    if (e.group) {
      route = mergeObject(route, compile_group(e.group, e.path, e.guard));
    } else if (e.handler) {
      if (!e.method) {
        e.method = "GET";
      }
      if (e.handler) {
        if (!route[e.method]) {
          route[e.method] = [];
        }
        route[e.method] = [
          ...route[e.method],
          ...[route_to_method(e.path, e.handler, e.guard)],
        ];
      }
    } else if (e.child) {
      if (e.guard) {
        route = mergeObject(route, child_route(e.path, e.child, e.guard));
      } else {
        route = mergeObject(route, child_route(e.path, e.child));
      }
    } else if (e.crud) {
      route = mergeObject(
        route,
        compile_group(
          {
            GET: [
              { path: "", handler: e.crud.all },
              { path: "/.+", handler: e.crud.show },
            ],
            POST: [
              { path: "", handler: e.crud.store },
              { path: "/.+", handler: e.crud.update },
            ],
            PATCH: [{ path: "", handler: e.crud.upsert }],
            DELETE: [{ path: "/.+", handler: e.crud.delete }],
          },
          e.path,
          e.guard
        )
      );
    }
  }
  console.log(route);
  return route;
}
function compile_group(
  group: Record<string, Route_Group_with[]>,
  path = "",
  guard: guard[] = []
) {
  const route: Routes = {};
  for (const [key, value] of Object.entries(group)) {
    if (!route[key]) {
      route[key] = [];
    }
    for (const e of value) {
      let x: any = {};
      if (e.path) {
        x.path = path + e.path;
      } else {
        x.path = path;
      }

      if (e.handler) {
        x.handler = e.handler;
      }

      if (e.guard) {
        x.guard = [...guard, ...e.guard];
      } else {
        x.guard = [...guard];
      }

      route[key] = [...route[key], x];
    }
  }
  return route;
}
