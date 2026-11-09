import type { AgentCard } from "../a2a/types.js";
import type { DocumentApi } from "../data/document-api.js";
import type { AgentHandler } from "../telemetry/wrapper.js";

export const DOKUMENTENAGENT_ID = "dokumentenagent";

// #region agent-card
/** Agent Card: sagt anderen Agenten, wer dieser Agent ist und was er kann. */
export function dokumentenagentCard(url: string): AgentCard {
  return {
    name: "Dokumentenagent",
    description: "Liefert die Dokumente zu einem Supportfall.",
    version: "0.1.0",
    supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "documents.read",
        name: "Dokumente lesen",
        description: "Gibt die Dokumente eines Falls zurück.",
        tags: ["documents", "read"],
      },
      {
        id: "documents.verify",
        name: "Dokumente prüfen",
        description: "Liest die Dokumente und stellt eine Rückfrage zum Fall.",
        tags: ["documents", "verify"],
      },
    ],
  };
}
// #endregion agent-card

// #region untrusted-content
/**
 * Erkennt Text, der wie eine Anweisung an den Agenten aussieht.
 * Das ist nur eine einfache Heuristik zum Markieren. Der eigentliche
 * Schutz ist die Berechtigungsmatrix: Rechte entstehen nie aus Inhalten.
 */
const INSTRUCTION_PATTERN = /(anweisung an den agenten|ignoriere .*regeln|admin-rechte)/i;

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERN.test(text);
}
// #endregion untrusted-content

// #region agent-definition
/**
 * Die Fachlogik des Dokumentenagenten. Sie läuft nur, wenn der Wrapper
 * den Aufruf erlaubt hat, und enthält selbst keine Berechtigungsprüfung.
 */
export function createDokumentenagent(deps: {
  documents: DocumentApi;
  pseudonymize: (caseId: string) => string;
}): AgentHandler {
  return async (request, invocation) => {
    const { caseId } = request.resource;

    // Zugriff auf die Datenquelle. Der Kontext sorgt dafür, dass der Span
    // der Dokumenten-API im selben Trace landet.
    const found = await deps.documents.list(
      caseId,
      invocation.context,
      deps.pseudonymize(caseId),
    );

    // Dokumente sind Daten, keine Anweisungen. Auffällige Inhalte werden
    // markiert und als Event im Span festgehalten (nur die Dokument-ID).
    const documents = found.map((document) => {
      const untrustedInstruction = looksLikeInstruction(document.content);
      if (untrustedInstruction) {
        invocation.span.addEvent("untrusted_content.flagged", {
          "app.document.id": document.id,
        });
      }
      return { ...document, untrustedInstruction };
    });

    if (request.action === "documents.verify") {
      // Rückfrage an den Supportagenten. Das wäre die dritte
      // Delegationsstufe, der Wrapper des Supportagenten lehnt sie ab.
      const clarification = await invocation.call("supportagent", {
        action: "cases.clarify",
        resource: { type: "support-case", caseId },
      });
      return { documents, clarification };
    }

    return { documents };
  };
}
// #endregion agent-definition
