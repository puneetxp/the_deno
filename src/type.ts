import { Model } from "./Model.ts";
import { Session } from "./Session.ts";

export type CallbackHandler = (
  request: Session,
  params: string[] | URLPatternResult,
) => Promise<Response>;

export type guard = (req: Request) => Promise<false | string>;
export type Routes = Record<string, Route[]>;
export type TheData = Record<string, number | string | string[] | number[]>;

export interface Route {
  handler: CallbackHandler;
  path: string;
  method?: string;
  islogin?: boolean;
  route?: URLPattern;
  roles?: string[];
  guard?: guard[];
}

export interface Login {
  name: string;
  email: string;
  id: number;
  roles: string[];
}

export interface relation {
  table: string;
  name: string;
  key: string;
  callback: () => Model<any>;
  relation?: relation;
}
export type _Routes = Route_Group_with[];

export interface Route_Group_with {
  path?: string;
  islogin?: boolean;
  guard?: guard[];
  method?: string;
  roles?: string[];
  handler?: CallbackHandler;
  crud?: any;
  child?: Route_Group_with[];
  group?: Record<string, Route_Group_with[]>;
}
