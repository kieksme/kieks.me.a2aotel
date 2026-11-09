import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  defaultTextMapGetter,
  defaultTextMapSetter,
  trace,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { fetchAgentCard, sendMessage } from "../a2a/client.js";
import { buildMessage, parseMessage } from "../a2a/envelope.js";
import type { InboundHandler } from "../a2a/server.js";
import type { AgentCard, AgentRequest, AgentResult, CallContext } from "../a2a/types.js";
import { checkPermission, type PolicyMatrix } from "../authz/policy.js";

/**
 * Der Wrapper legt sich um jeden Agenten und erledigt drei Dinge,
 * die der Agentencode selbst nicht tun soll:
 *   1. Trace-Kontext übernehmen und weitergeben (durchgehende Trace-ID)
 *   2. Berechtigung prüfen, bevor der Agent überhaupt läuft
 *   3. Jede Entscheidung als Span festhalten, auch die Ablehnung
 */

/** Was der Agentencode vom Wrapper bekommt. */
export interface Invocation {
  /** OTel-Kontext mit dem aktiven Span. Für eigene Kind-Spans. */
  context: Context;
  span: Span;
  callContext: CallContext;
  /** Der einzige Weg zu anderen Agenten führt über den Wrapper. */
  call(targetAgentId: string, request: AgentRequest): Promise<AgentResult>;
}

export type AgentHandler = (request: AgentRequest, invocation: Invocation) => Promise<unknown>;

export interface GuardOptions {
  agentId: string;
  tracer: Tracer;
  matrix: PolicyMatrix;
  /** Adressen der anderen Agenten: Agenten-ID zu Basis-URL. */
  peers: Map<string, string>;
  pseudonymize: (caseId: string) => string;
}

const propagator = new W3CTraceContextPropagator();

/**
 * Attribute für die Berechtigungsentscheidung. Dafür gibt es keine
 * OpenTelemetry-Konvention, deshalb ein eigener Namensraum "app.".
 * Es landen nur IDs, Kategorien und Referenzen im Span.
 * Keine Tokens, keine Inhalte, keine personenbezogenen Daten.
 */
function requestAttributes(
  options: GuardOptions,
  target: string,
  request: AgentRequest,
  context: CallContext,
) {
  return {
    "app.caller.agent_id": context.callerAgentId,
    "app.target.agent_id": target,
    "app.authz.action": request.action,
    "app.authz.resource": request.resource.type,
    "app.case.ref": options.pseudonymize(request.resource.caseId),
    "app.delegation.depth": context.delegationChain.length,
    ...(context.approvalRef ? { "app.approval.ref": context.approvalRef } : {}),
  };
}

// #region wrapper-inbound
/** Legt den Wrapper um einen Agenten. Das Ergebnis hängt am A2A-Server. */
export function guard(options: GuardOptions, handler: AgentHandler): InboundHandler {
  const { agentId, tracer, matrix } = options;
  const cards = new Map<string, AgentCard>();

  return async (headers, message) => {
    const { request, context: callContext } = parseMessage(message);

    // #region trace-extract
    // Trace-Kontext aus dem traceparent-Header lesen. Dadurch hängt
    // dieser Span am Span des Aufrufers und behält dessen Trace-ID.
    const parent = propagator.extract(ROOT_CONTEXT, headers, defaultTextMapGetter);
    // #endregion trace-extract

    // #region span-start
    // Ein Span pro Aufruf. Name und gen_ai-Attribute folgen den
    // GenAI-Konventionen von OpenTelemetry (Status: Development).
    // Die Konvention sieht für Agenten im selben Prozess INTERNAL vor.
    // Hier kommt der Aufruf über das Netz, deshalb SERVER.
    const span = tracer.startSpan(
      `invoke_agent ${agentId}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.agent.id": agentId,
          "gen_ai.agent.name": agentId,
          ...requestAttributes(options, agentId, request, callContext),
        },
      },
      parent,
    );
    const context = trace.setSpan(parent, span);
    // #endregion span-start

    try {
      // #region authz-enforce
      // Erst prüfen, dann ausführen. Die Entscheidung kommt immer in den
      // Span, mit Begründungskategorie und Regelversion.
      const decision = checkPermission(matrix, agentId, request, callContext);
      span.setAttributes({
        "app.authz.decision": decision.allowed ? "allowed" : "denied",
        "app.authz.reason": decision.reasonCategory,
        "app.authz.policy_version": decision.policyVersion,
      });
      span.addEvent("authz.decision", {
        "app.authz.decision": decision.allowed ? "allowed" : "denied",
        "app.authz.reason": decision.reasonCategory,
      });

      if (!decision.allowed) {
        // Verweigert: Der Agent läuft gar nicht erst. Der Span wird als
        // Fehler markiert, damit die Ablehnung im Trace auffällt.
        span.setAttribute("error.type", decision.reasonCategory);
        span.setStatus({ code: SpanStatusCode.ERROR, message: decision.reasonCategory });
        return {
          status: "denied",
          reasonCategory: decision.reasonCategory,
          policyVersion: decision.policyVersion,
        };
      }
      // #endregion authz-enforce

      // #region agent-run
      // Erlaubt: Agent ausführen. Er bekommt den Kontext und eine
      // call-Funktion, die wieder durch den Wrapper geht.
      const data = await handler(request, {
        context,
        span,
        callContext,
        call: (target, next) => callAgent(target, next, context, callContext),
      });
      return { status: "ok", data };
      // #endregion agent-run
    } catch (error) {
      span.recordException(error as Error);
      span.setAttribute("error.type", (error as Error).name);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  };
  // #endregion wrapper-inbound

  // #region wrapper-outbound
  /** Ausgehender Aufruf an einen anderen Agenten. */
  async function callAgent(
    target: string,
    request: AgentRequest,
    parent: Context,
    inbound: CallContext,
  ): Promise<AgentResult> {
    // Der Wrapper baut den Kontext für den nächsten Agenten. Fallbezug und
    // Freigabe werden übernommen, die Kette wird um diesen Agenten verlängert.
    // Der Agentencode kann daran nichts ändern.
    const outgoing: CallContext = {
      callerAgentId: agentId,
      caseId: inbound.caseId,
      approvalRef: inbound.approvalRef,
      delegationChain: [...inbound.delegationChain, agentId],
    };

    const span = tracer.startSpan(
      `invoke_agent ${target}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.agent.id": target,
          "gen_ai.agent.name": target,
          ...requestAttributes(options, target, request, outgoing),
        },
      },
      parent,
    );

    try {
      const baseUrl = options.peers.get(target);
      if (!baseUrl) throw new Error(`Unbekannter Agent: ${target}`);
      let card = cards.get(target);
      if (!card) {
        card = await fetchAgentCard(baseUrl);
        cards.set(target, card);
      }

      // #region trace-inject
      // Trace-Kontext als traceparent-Header mitschicken. Ohne diesen
      // Schritt würde beim Zielagenten ein neuer Trace beginnen.
      const headers: Record<string, string> = {};
      propagator.inject(trace.setSpan(parent, span), headers, defaultTextMapSetter);
      // #endregion trace-inject

      const result = await sendMessage(card, buildMessage(request, outgoing), headers);

      // Das Ergebnis auch auf der Aufruferseite festhalten. So ist eine
      // verweigerte Kante von beiden Seiten aus sichtbar.
      span.setAttribute("app.authz.decision", result.status === "ok" ? "allowed" : "denied");
      if (result.status === "denied") {
        span.setAttributes({
          "app.authz.reason": result.reasonCategory,
          "app.authz.policy_version": result.policyVersion,
          "error.type": result.reasonCategory,
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.reasonCategory });
      }
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setAttribute("error.type", (error as Error).name);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  }
  // #endregion wrapper-outbound
}
