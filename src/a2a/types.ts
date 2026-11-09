/**
 * Minimale Typen in Anlehnung an das A2A-Protokoll 1.0
 * (https://a2a-protocol.org/latest/specification/).
 *
 * Das ist bewusst nur ein Ausschnitt und keine vollständige, konforme
 * Implementierung. Für produktive Systeme das offizielle SDK verwenden.
 */

export const A2A_PROTOCOL_VERSION = "1.0";
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface AgentInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
}

/** Agent Card: die maschinenlesbare Selbstbeschreibung eines Agenten. */
export interface AgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: AgentInterface[];
  capabilities: { streaming?: boolean; pushNotifications?: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}

/** Ein Part enthält genau eines der Inhaltsfelder. Hier genügen Text und Daten. */
export type Part = { text: string } | { data: unknown; mediaType?: string };

export interface Message {
  messageId: string;
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: Part[];
  metadata?: Record<string, unknown>;
}

/**
 * Aufrufkontext, den der Wrapper in `message.metadata` mitschickt.
 * Der Agentencode selbst kann ihn nicht verändern.
 */
export interface CallContext {
  /** Wer ruft auf. In Produktion kommt das aus einem geprüften Token, nicht aus dem Request. */
  callerAgentId: string;
  /** Fallbezug: der Fall, für den die Kette gestartet wurde. */
  caseId?: string;
  /** Freigabereferenz der auslösenden Stelle. */
  approvalRef?: string;
  /** Alle bisherigen Aufrufer in Reihenfolge. Die Länge ist die Delegationsstufe. */
  delegationChain: string[];
}

/** Fachliche Anfrage an einen Agenten. */
export interface AgentRequest {
  action: string;
  resource: { type: string; caseId: string };
  params?: Record<string, unknown>;
}

export type AgentResult =
  | { status: "ok"; data: unknown }
  | { status: "denied"; reasonCategory: string; policyVersion: string };

export const CALL_CONTEXT_KEY = "callContext";
