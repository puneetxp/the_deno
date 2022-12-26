import {
  Cookie,
  deleteCookie,
  getCookies,
  setCookie,
} from "https://deno.land/std@0.170.0/http/cookie.ts";
import type { Active_role, Role, User } from "./type.ts";
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
  date: Date,
  domain: string
): Cookie => {
  return {
    name: "PHPSESSID",
    value: session_id,
    httpOnly: true,
    path: "/",
    domain: domain,
    sameSite: "Strict",
    expires: date,
  };
};
class S {
  Session!: string;
  expirein = 30;
  time: Date;
  constructor(public req: Request) {
    const cookie = getCookies(req.headers);
    this.time = new Date();
    this.expire();
    if (cookie.PHPSESSID) {
      this.Session = cookie.PHPSESSID;
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

  validSession(session_id: string) {
    return sessions.find((i) => {
      i.session_id == session_id &&
        i.ip == this.req.headers.get("x-forwarded-for") &&
        i.agent == this.req.headers.get("user-agent");
    });
  }
  expire() {
    this.time.setTime(this.time.getTime() + this.expirein * 60 * 1000);
  }
  SessionRoles(Role: Role[], Active_Role: Active_role[]) {
    return Role.filter((i) => Active_Role.filter((a) => a.role_id == i.id)).map(
      (i) => i.name
    );
  }
  getSessionRoles(session_id: string) {
    return sessions.find((i) => i.session_id == session_id) || false;
  }
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
    setCookie(
      headers,
      sessionCookie(this.Session, this.time, this.req.headers.get("host") || "")
    );
    return {
      "set-cookie": headers.get("set-cookie"),
    };
  }

  overwriteSession() {}
  getSession() {}
  getLogin(): Login | false {
    const p = sessions.find((i) => i.session_id == this.Session);
    if (p) {
      return { name: p?.name, email: p?.email, id: p?.id, roles: p?.roles };
    }
    return false;
  }
}

export const Session = (req: Request) => new S(req);
export interface Login {
  name: string;
  email: string;
  id: number;
  roles: string[];
}
