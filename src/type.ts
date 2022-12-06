export type CallbackHandler = (
 request: Request,
 params: any[],
) => Promise<Response>;

export type Routes = Record<string, Route[]>

export interface Route {
 path: string;
 handler: CallbackHandler;
 guard?: () => Promise<false | string>;
 child?: Route[];
}