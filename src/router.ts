import { response } from "./response.ts";
import "https://deno.land/std@0.167.0/dotenv/load.ts";
import { Routes } from "./type.ts";
export class Router {
  constructor(public routes_list: Routes) {
  }
  async route(req: Request): Promise<Response> {
    const relativepath = req.url.replace(new RegExp('.*' + Deno.env.get('web') || ''), '');
    const pathparam = relativepath.split('/');
    const r = this.routes_list[req.method].find(i => { return i.path.split('/').length == relativepath.split('/').length && relativepath.match(`${i.path.replaceAll('/', '\/')}$`) });
    if (r) {
      if (r.guard) {
        const guard = await r.guard();
        if (guard) {
          return response.JSON200({ guard });
        }
      }
      const params: any[] = [];
      r.path.split('/').forEach((e, key) => { if (e == '.+') { params.push(pathparam[key]) } });
      return await r.handler(req, params);
    }
    return await response.JSON404(null);
  }

}
