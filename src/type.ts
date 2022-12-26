export type CallbackHandler = (
  request: Request,
  params: any[]
) => Promise<Response>;

export type guard = () => Promise<false | string>;
export type Routes = Record<string, Route[]>;
export type TheData = Record<string, string>;

export interface Route {
  path: string;
  handler: CallbackHandler;
  guard?: guard[];
}

export interface Where {
  [key: string]: string[] | string;
}

export type _Routes = Route_Group_with[];

export interface Route_Group_with {
  path: string;
  guard?: guard[];
  method?: string;
  handler?: CallbackHandler;
  crud?: any;
  child?: Route_Group_with[];
  group?: Record<string, Route_Group_with[]>;
}


export interface Route_Group_with {
  path: string;
  guard?: guard[];
  method?: string;
  handler?: CallbackHandler;
  controller?: any;
  group?: Record<string, Route_Group_with[]>;
}
export interface Active_role {
  updated_at: Date;
  user_id: number;
  role_id: number;
}
export interface User {
  name: string;
  email: string;
  phone: string | null;
  google_id: string | null;
  facebook_id: string | null;
  password: string | null;
  enable: number;
  id: number;
  created_at: Date;
  updated_at: Date;
}
export interface Role {
  name: string;
  enable: number;
  id: number;
  created_at: Date;
  updated_at: Date;
}
