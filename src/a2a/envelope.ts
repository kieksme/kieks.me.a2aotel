import { randomUUID } from "node:crypto";
import {
  CALL_CONTEXT_KEY,
  type AgentRequest,
  type AgentResult,
  type CallContext,
  type Message,
} from "./types.js";

/** Verpackt Anfrage und Aufrufkontext in eine A2A-Nachricht. */
export function buildMessage(request: AgentRequest, context: CallContext): Message {
  return {
    messageId: randomUUID(),
    role: "ROLE_USER",
    parts: [{ data: request, mediaType: "application/json" }],
    metadata: { [CALL_CONTEXT_KEY]: context },
  };
}

export function buildResultMessage(result: AgentResult): Message {
  return {
    messageId: randomUUID(),
    role: "ROLE_AGENT",
    parts: [{ data: result, mediaType: "application/json" }],
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Liest Anfrage und Aufrufkontext aus einer eingehenden Nachricht.
 * Eingaben von außen werden geprüft, bevor irgendetwas damit passiert.
 */
export function parseMessage(message: unknown): {
  request: AgentRequest;
  context: CallContext;
} {
  if (!isRecord(message) || !Array.isArray(message.parts)) {
    throw new InvalidMessageError("message.parts fehlt");
  }
  const part = message.parts.find((p) => isRecord(p) && "data" in p) as
    | { data: unknown }
    | undefined;
  const request = part?.data;
  if (
    !isRecord(request) ||
    typeof request.action !== "string" ||
    !isRecord(request.resource) ||
    typeof request.resource.type !== "string" ||
    typeof request.resource.caseId !== "string"
  ) {
    throw new InvalidMessageError("Anfrage ist unvollständig");
  }

  const raw = isRecord(message.metadata) ? message.metadata[CALL_CONTEXT_KEY] : undefined;
  if (
    !isRecord(raw) ||
    typeof raw.callerAgentId !== "string" ||
    !Array.isArray(raw.delegationChain) ||
    !raw.delegationChain.every((e) => typeof e === "string")
  ) {
    throw new InvalidMessageError("Aufrufkontext fehlt oder ist ungültig");
  }

  return {
    request: {
      action: request.action,
      resource: { type: request.resource.type, caseId: request.resource.caseId },
      params: isRecord(request.params) ? request.params : undefined,
    },
    context: {
      callerAgentId: raw.callerAgentId,
      caseId: typeof raw.caseId === "string" ? raw.caseId : undefined,
      approvalRef: typeof raw.approvalRef === "string" ? raw.approvalRef : undefined,
      delegationChain: raw.delegationChain as string[],
    },
  };
}

export class InvalidMessageError extends Error {}
