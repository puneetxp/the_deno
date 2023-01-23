import { Model } from "./Model.ts";
import { Session } from "./Session.ts";

export type CallbackHandler = (
  request: Request,
  params: any[],
) => Promise<Response>;

export type CallbackHandlerLogin = (
  session: Session,
  params: any[]
) => Promise<Response>;

export function isCallbackHandler(
  fun: CallbackHandler | CallbackHandlerLogin,
): fun is CallbackHandler {
  return (fun as CallbackHandler) !== undefined;
}
export function isCallbackHandlerLogin(
  fun: CallbackHandler | CallbackHandlerLogin,
): fun is CallbackHandlerLogin {
  return (fun as CallbackHandlerLogin) !== undefined;
}

export type guard = (req: Request) => Promise<false | string>;
export type Routes = Record<string, Route[]>;
export type TheData = Record<string, string>;

export interface Route {
  handler: CallbackHandler | CallbackHandlerLogin;
  path: string;
  method?: string;
  islogin?: boolean;
  roles?: string[];
  guard?: guard[];
}

export interface Login {
  name: string;
  email: string;
  id: number;
  roles: string[];
}
export interface Where {
  [key: string]: string[] | string | number | number[];
}
export interface relation {
  table: string;
  name: string;
  key: string;
  callback: () => Model;
  relation?: relation;
}
export type _Routes = Route_Group_with[];

export interface Route_Group_with {
  path?: string;
  islogin?: boolean;
  guard?: guard[];
  method?: string;
  roles?: string[];
  handler?: CallbackHandler | CallbackHandlerLogin;
  crud?: any;
  child?: Route_Group_with[];
  group?: Record<string, Route_Group_with[]>;
}

