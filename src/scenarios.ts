import type { Order } from "./system.js";

export interface Scenario {
  title: string;
  expectation: string;
  order: Order;
}

const APPROVAL = "FRG-2026-0001";

/** Die Szenarien des Beispiels. CLI und Tests nutzen dieselbe Liste. */
export const scenarios: Record<string, Scenario> = {
  allowed: {
    title: "Erlaubter Aufruf",
    expectation: "Der Supportagent bekommt die Dokumente seines Falls.",
    order: { caseId: "SUP-2026-0042", approvalRef: APPROVAL, targetCaseId: "SUP-2026-0042" },
  },
  "foreign-case": {
    title: "Fremde Fall-ID",
    expectation: "Der Dokumentenagent verweigert den Zugriff (case_mismatch).",
    order: {
      caseId: "SUP-2026-0042",
      approvalRef: APPROVAL,
      targetCaseId: "SUP-2026-0042",
      params: { documentsOfCase: "SUP-2026-0099" },
    },
  },
  "third-level": {
    title: "Dritte Delegationsstufe",
    expectation:
      "Die Rückfrage des Dokumentenagenten wird verweigert (delegation_depth_exceeded).",
    order: {
      caseId: "SUP-2026-0042",
      approvalRef: APPROVAL,
      targetCaseId: "SUP-2026-0042",
      params: { verify: true },
    },
  },
  injection: {
    title: "Dokument mit Anweisung zur Rechteausweitung",
    expectation: "Die Anweisung im Dokument wird markiert und ignoriert.",
    order: { caseId: "SUP-2026-0043", approvalRef: APPROVAL, targetCaseId: "SUP-2026-0043" },
  },
  "no-case": {
    title: "Ohne Fallbezug",
    expectation: "Der Auftrag wird abgelehnt (missing_case_context).",
    order: { approvalRef: APPROVAL, targetCaseId: "SUP-2026-0042" },
  },
};
