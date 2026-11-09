import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildResultMessage, InvalidMessageError } from "./envelope.js";
import { AGENT_CARD_PATH, type AgentCard, type AgentResult } from "./types.js";

/** Bekommt die HTTP-Header (für den Trace-Kontext) und die A2A-Nachricht. */
export type InboundHandler = (
  headers: Record<string, string | undefined>,
  message: unknown,
) => Promise<AgentResult>;

export interface AgentServer {
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new InvalidMessageError("Anfrage zu groß");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidMessageError("Kein gültiges JSON");
  }
}

/**
 * Startet einen kleinen A2A-ähnlichen Server:
 *   GET  /.well-known/agent-card.json  liefert die Agent Card
 *   POST /                             JSON-RPC, Methode "SendMessage"
 *
 * Er lauscht nur auf 127.0.0.1. Es gibt keine Authentifizierung,
 * das Beispiel ist für den lokalen Betrieb gedacht.
 */
export async function startAgentServer(options: {
  card: (url: string) => AgentCard;
  handler: InboundHandler;
  port?: number;
}): Promise<AgentServer> {
  let card: AgentCard | undefined;

  const server: Server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && req.url === AGENT_CARD_PATH) {
      return send(200, card);
    }
    if (req.method !== "POST" || req.url !== "/") {
      return send(404, { error: "not found" });
    }

    let id: unknown = null;
    try {
      const rpc = (await readJson(req)) as {
        id?: unknown;
        method?: unknown;
        params?: { message?: unknown };
      };
      id = rpc?.id ?? null;
      if (rpc?.method !== "SendMessage") {
        return send(200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
      }
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
      const result = await options.handler(headers, rpc.params?.message);
      return send(200, { jsonrpc: "2.0", id, result: { message: buildResultMessage(result) } });
    } catch (error) {
      // Keine internen Details nach außen geben.
      const invalid = error instanceof InvalidMessageError;
      return send(200, {
        jsonrpc: "2.0",
        id,
        error: invalid
          ? { code: -32602, message: "Invalid params" }
          : { code: -32603, message: "Internal error" },
      });
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  card = options.card(url);

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
