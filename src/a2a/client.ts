import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  type AgentCard,
  type AgentResult,
  type Message,
} from "./types.js";

/** Holt die Agent Card eines Agenten von der Well-Known-Adresse. */
export async function fetchAgentCard(baseUrl: string): Promise<AgentCard> {
  const response = await fetch(new URL(AGENT_CARD_PATH, baseUrl));
  if (!response.ok) {
    throw new Error(`Agent Card nicht abrufbar (HTTP ${response.status})`);
  }
  return (await response.json()) as AgentCard;
}

/**
 * Schickt eine Nachricht per JSON-RPC "SendMessage" an einen Agenten.
 * In `headers` reist der Trace-Kontext (traceparent) mit.
 */
export async function sendMessage(
  card: AgentCard,
  message: Message,
  headers: Record<string, string> = {},
): Promise<AgentResult> {
  const endpoint = card.supportedInterfaces[0]?.url;
  if (!endpoint) throw new Error(`Agent Card von ${card.name} nennt keine Schnittstelle`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "A2A-Version": A2A_PROTOCOL_VERSION,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: message.messageId,
      method: "SendMessage",
      params: { message },
    }),
  });
  const body = (await response.json()) as {
    result?: { message?: Message };
    error?: { code: number; message: string };
  };
  if (body.error) {
    throw new Error(`A2A-Fehler ${body.error.code}: ${body.error.message}`);
  }
  const part = body.result?.message?.parts.find((p) => "data" in p);
  if (!part || !("data" in part)) throw new Error("Antwort ohne Ergebnis");
  return part.data as AgentResult;
}
