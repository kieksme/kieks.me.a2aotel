import type { SpanExporter } from "@opentelemetry/sdk-trace";
import { fetchAgentCard, sendMessage } from "./a2a/client.js";
import { buildMessage } from "./a2a/envelope.js";
import { startAgentServer } from "./a2a/server.js";
import type { AgentResult } from "./a2a/types.js";
import {
  createDokumentenagent,
  DOKUMENTENAGENT_ID,
  dokumentenagentCard,
} from "./agents/dokumentenagent.js";
import { createSupportagent, SUPPORTAGENT_ID, supportagentCard } from "./agents/supportagent.js";
import { loadMatrix, type PolicyMatrix } from "./authz/policy.js";
import { createDocumentApi } from "./data/document-api.js";
import { mockModel } from "./model/mock.js";
import type { ModelProvider } from "./model/provider.js";
import { createPseudonymizer } from "./telemetry/pseudonym.js";
import { createTelemetry } from "./telemetry/setup.js";
import { guard } from "./telemetry/wrapper.js";

/** Auftrag der Sachbearbeitung an den Supportagenten. */
export interface Order {
  /** Fallbezug. Fehlt er, wird der Auftrag abgelehnt. */
  caseId?: string;
  approvalRef?: string;
  /** Fall, zu dem der Auftrag gehört. */
  targetCaseId: string;
  params?: Record<string, unknown>;
}

export interface System {
  urls: { supportagent: string; dokumentenagent: string };
  pseudonymize(caseId: string): string;
  submit(order: Order): Promise<AgentResult>;
  stop(): Promise<void>;
}

/** Startet beide Agenten samt Datenquelle lokal und verdrahtet sie. */
export async function startSystem(options: {
  exporters: SpanExporter[];
  model?: ModelProvider;
  matrix?: PolicyMatrix;
}): Promise<System> {
  const matrix = options.matrix ?? loadMatrix();
  const model = options.model ?? mockModel;
  const pseudonymize = createPseudonymizer();
  const peers = new Map<string, string>();

  const support = createTelemetry(SUPPORTAGENT_ID, options.exporters);
  const documents = createTelemetry(DOKUMENTENAGENT_ID, options.exporters);
  const documentApi = createTelemetry("dokumenten-api", options.exporters);

  const supportServer = await startAgentServer({
    card: supportagentCard,
    handler: guard(
      { agentId: SUPPORTAGENT_ID, tracer: support.tracer, matrix, peers, pseudonymize },
      createSupportagent({ model, tracer: support.tracer }),
    ),
  });
  const documentServer = await startAgentServer({
    card: dokumentenagentCard,
    handler: guard(
      { agentId: DOKUMENTENAGENT_ID, tracer: documents.tracer, matrix, peers, pseudonymize },
      createDokumentenagent({
        documents: createDocumentApi(documentApi.tracer),
        pseudonymize,
      }),
    ),
  });
  peers.set(SUPPORTAGENT_ID, supportServer.url);
  peers.set(DOKUMENTENAGENT_ID, documentServer.url);

  return {
    urls: { supportagent: supportServer.url, dokumentenagent: documentServer.url },
    pseudonymize,
    async submit(order) {
      const card = await fetchAgentCard(supportServer.url);
      return sendMessage(
        card,
        buildMessage(
          {
            action: "cases.assess",
            resource: { type: "support-case", caseId: order.targetCaseId },
            params: order.params,
          },
          {
            callerAgentId: "sachbearbeitung",
            caseId: order.caseId,
            approvalRef: order.approvalRef,
            delegationChain: ["sachbearbeitung"],
          },
        ),
      );
    },
    async stop() {
      await Promise.all([supportServer.close(), documentServer.close()]);
      await Promise.all([support.shutdown(), documents.shutdown(), documentApi.shutdown()]);
    },
  };
}
