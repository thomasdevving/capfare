/** Tiny JSON HTTP server helper (no framework) with body limits and CORS allowlist. */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

export type Handler = (body: any, req: IncomingMessage) => Promise<unknown> | unknown;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ServeOptions {
  port: number;
  routes: Record<string, Handler>; // "GET /path" | "POST /path"
  maxBodyBytes?: number;
  corsOrigins?: string[];
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

async function readBody(req: IncomingMessage, limit: number): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "request too large");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export function serve(opts: ServeOptions): Server {
  const limit = opts.maxBodyBytes ?? 2 * 1024 * 1024;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && (opts.corsOrigins ?? []).some((o) => o === "*" || o === origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const path = (req.url ?? "/").split("?")[0];
    const handler = opts.routes[`${req.method} ${path}`];
    const started = Date.now();
    try {
      if (!handler) throw new HttpError(404, "not found");
      const body = req.method === "POST" ? await readBody(req, limit) : Object.fromEntries(new URL(req.url ?? "/", "http://x").searchParams);
      const out = await handler(body, req);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      opts.log?.("request", { method: req.method, path, status: 200, ms: Date.now() - started });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ error: message }));
      opts.log?.("request", { method: req.method, path, status, ms: Date.now() - started, error: status === 500 ? message : undefined });
    }
  });
  server.listen(opts.port);
  return server;
}
