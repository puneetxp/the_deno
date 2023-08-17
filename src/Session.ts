import { Cookie, deleteCookie, getCookies, getSetCookies, setCookie } from "../deps.ts";

interface Active_role {
  updated_at: Date;
  user_id: number;
  role_id: number;
}

interface Role {
  name: string;
  enable: number;
  id: number;
  created_at: Date;
  updated_at: Date;
}
interface User {
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
import { Login } from "./type.ts";
interface LoginSession {
  session_id: string;
  name: string;
  expire: Date;
  email: string;
  id: number;
  roles: string[];
  ip: string | null;
  agent: string | null;
}

let sessions: LoginSession[] = [];
const sessionCookie = (
  session_id: string,
  date: Date
): Cookie => {
  return {
    name: "PHPSESSID",
    value: session_id,
    httpOnly: true,
    path: "/",
    domain: "." + Deno.env.get("host"),
    sameSite: Deno.env.get("samesite") as "Strict" | "Lax" | "None",
    secure: Deno.env.has("secure"),
    expires: date,
  };
};
export class Session {
  Session!: string;
  expirein = 30;
  time: Date;
  ActiveLoginSession: LoginSession | undefined;
  Login!: Login;
  constructor(public req: Request, public cookie?: Record<string, string>) {
    this.time = new Date();
    this.expire();
    if (this.cookie) {
      this.Session = this.cookie.PHPSESSID;
    }
  }
  expireSet(miniutes: number) {
    this.expirein = miniutes;
    return this;
  }
  startnew(User: User, Role: Role[] = [], Active_Role: Active_role[] = []) {
    if (this.Session) {
      this.removeSession();
    }
    this.newSession(User, Role, Active_Role);
    return this;
  }
  newSession(User: User, Role: Role[], Active_Role: Active_role[]) {
    this.Session = crypto.randomUUID();
    return this.addSession({
      session_id: this.Session,
      name: User.name,
      email: User.email,
      expire: this.time,
      id: User.id,
      roles: this.SessionRoles(Role, Active_Role),
      ip: this.req.headers.get("x-forwarded-for"),
      agent: this.req.headers.get("user-agent"),
    });
  }
  validSessionIp() {
    this.ActiveLoginSession = sessions.find((i) => {
      i.expire > new Date() &&
        i.session_id == this.Session &&
        i.ip == this.req.headers.get("x-forwarded-for") &&
        i.agent == this.req.headers.get("user-agent");
    });
    return this;
  }
  validSession() {
    this.ActiveLoginSession = sessions.find((i) => {
      i.expire > new Date() &&
        i.session_id == this.Session &&
        i.agent == this.req.headers.get("user-agent");
    });
    return this;
  }
  expire() {
    this.time.setTime(this.time.getTime() + this.expirein * 60 * 1000);
  }
  SessionRoles(Role: Role[], Active_Role: Active_role[]) {
    return Role.filter((i) => Active_Role.filter((a) => a.role_id == i.id)).map(
      (i) => i.name,
    );
  }
  // getSessionRoles(session_id: string) {
  //   return sessions.find((i) => i.session_id == session_id) || false;
  // }
  addSession(LoginSession: LoginSession) {
    sessions = [...sessions, LoginSession];
  }
  removeSession() {
    sessions = sessions.filter((i) => i.session_id != this.Session);
  }

  removeCookie() {
    this.removeSession();
    const headers = new Headers();
    deleteCookie(headers, "PHPSESSID");
    return {
      "set-cookie": headers.get("set-cookie"),
    };
  }

  returnCookie() {
    const headers = new Headers();
    setCookie(headers, sessionCookie(this.Session, this.time));
    const cookie = headers.get("set-cookie");
    if (cookie != null) {
      return {
        "set-cookie": cookie,
      };
    }
  }
  reactiveSession() {
    this.ActiveLoginSession &&
      ((this.ActiveLoginSession.expire = this.time),
        (sessions = [
          ...sessions.filter((i) => i.session_id !== this.Session),
          this.ActiveLoginSession,
        ]));
    return this;
  }
  getLogin() {
    if (this.ActiveLoginSession) {
      this.Login = {
        name: this.ActiveLoginSession.name,
        email: this.ActiveLoginSession.email,
        id: this.ActiveLoginSession.id,
        roles: this.ActiveLoginSession.roles,
      };
    }
    return this;
  }
}
