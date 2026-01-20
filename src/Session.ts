import type { Cookie } from "../deps.ts";
import { deleteCookie, setCookie } from "../deps.ts";

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
  telegram_id: string | null;
}
import type { Login } from "./type.ts";
interface LoginSession {
  books: number[];
  book: number;
  session_id: string;
  name: string;
  expire: Date;
  email: string;
  id: number;
  roles: string[];
  ip: string | null;
  agent: string | null;
  telegram_id: string | null;
}

let sessions: LoginSession[] = [];
let Roles: Role[] = [];
export function setRole(x: Role[]) {
  Roles = x;
}
const kv = await Deno.openKv();
const sessionCookie = (
  session_id: string,
  date: Date,
): Cookie => {
  return {
    name: "PHPSESSID",
    value: session_id,
    httpOnly: true,
    path: "/",
    domain: Deno.env.get("ssl"),
    sameSite: Deno.env.get("samesite") as "Strict" | "Lax" | "None",
    secure: Deno.env.has("secure"),
    expires: date,
  };
};
export class Session {
  Session!: string;
  expirein = 3000;
  time: Date;
  ActiveLoginSession?: LoginSession;
  Login!: Login;
  constructor(public req: Request, public cookie?: Record<string, string>) {
    this.time = new Date();
    this.expire();
    if (this.cookie) {
      this.Session = this.cookie.PHPSESSID;
    }
  }
  cleansession(): this {
    sessions = sessions.filter((i) => i.expire > new Date());
    return this;
  }
  expireSet(miniutes: number): this {
    this.expirein = miniutes;
    return this;
  }
  startnew(
    User: User,
    Active_Role: Active_role[] = [],
    books: number[] = [],
    book: number | undefined = undefined,
  ): this {
    if (!book) {
      book = books[0];
    }
    if (this.Session) {
      this.removeSession();
    }
    this.newSession(User, Active_Role, books, book);
    return this;
  }
  newSession(
    User: User,
    Active_Role: Active_role[],
    books: number[],
    book: number,
  ) {
    this.Session = crypto.randomUUID();
    this.ActiveLoginSession = {
      books: books,
      book: book,
      session_id: this.Session,
      name: User.name,
      email: User.email,
      expire: this.time,
      id: User.id,
      roles: this.SessionRoles(Roles, Active_Role),
      ip: this.req.headers.get("x-forwarded-for"),
      agent: this.req.headers.get("user-agent"),
      telegram_id: User.telegram_id ?? null,
    };
    this.addSession(this.ActiveLoginSession);
  }
  validSessionIp(): this {
    this.ActiveLoginSession = sessions.find((i) => {
      i.expire > new Date() &&
        i.session_id == this.Session &&
        i.ip == this.req.headers.get("x-forwarded-for") &&
        i.agent == this.req.headers.get("user-agent");
    });
    return this;
  }
  async validSession(): Promise<this> {
    const x = (await kv.get<LoginSession>(["users", this.Session])).value;
    if (x) {
      if (
        x.session_id == this.Session &&
        x.agent == this.req.headers.get("user-agent")
      ) {
        this.ActiveLoginSession = x;
      }
    }
    return this;
  }
  expire() {
    this.time.setTime(this.time.getTime() + this.expirein * 60 * 1000);
  }
  SessionRoles(Role: Role[], Active_Role: Active_role[]): string[] {
    return Role.filter((i) => Active_Role.some((a) => a.role_id === i.id)).map(
      (i) => i.name,
    );
  }
  async addSession(LoginSession: LoginSession) {
    const expireIn = sessionExpireInMs(LoginSession);
    await kv.set(
      ["users", LoginSession.session_id],
      LoginSession,
      expireIn ? { expireIn } : undefined,
    );
  }
  removeSession(): void {
    kv.delete(["users", this.Session]);
  }

  removeCookie(): { "set-cookie"?: string | null } {
    this.removeSession();
    const headers = new Headers();
    deleteCookie(headers, "PHPSESSID");
    return {
      "set-cookie": headers.get("set-cookie"),
    };
  }

  returnCookie(): { "set-cookie"?: string } | undefined {
    if (typeof this.Session !== "string" || this.Session.length === 0) {
      return;
    }
    const headers = new Headers();
    setCookie(headers, sessionCookie(this.Session, this.time));
    const cookie = headers.get("set-cookie");
    if (cookie != null) {
      return {
        "set-cookie": cookie,
      };
    }
  }
  reactiveSession(): this {
    if (this.ActiveLoginSession) {
      this.ActiveLoginSession.expire = this.time;
      kv.delete(["users", this.Session]);
      const expireIn = sessionExpireInMs(this.ActiveLoginSession);
      kv.set(
        ["users", this.ActiveLoginSession.session_id],
        this.ActiveLoginSession,
        expireIn ? { expireIn } : undefined,
      );
    }
    return this;
  }
  getLogin(): this {
    if (this.ActiveLoginSession) {
      this.Login = {
        name: this.ActiveLoginSession.name,
        email: this.ActiveLoginSession.email,
        id: this.ActiveLoginSession.id,
        roles: this.ActiveLoginSession.roles,
        telegram_id: this.ActiveLoginSession.telegram_id,
      };
    }
    return this;
  }
}

function sessionExpireInMs(session: LoginSession): number | undefined {
  if (!session.expire) {
    return;
  }
  const expireTime = session.expire instanceof Date
    ? session.expire.getTime()
    : new Date(session.expire).getTime();
  const diff = expireTime - Date.now();
  return diff > 0 ? diff : 0;
}
