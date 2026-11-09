import { readFileSync } from "node:fs";
import type { AgentRequest, CallContext } from "../a2a/types.js";

/** Eine Zeile der Berechtigungsmatrix: wer darf bei wem was auf welcher Ressource. */
export interface Rule {
  caller: string;
  target: string;
  action: string;
  resourceType: string;
}

export interface PolicyMatrix {
  /** Regelversion. Landet in jedem Span, damit eine Entscheidung später nachvollziehbar ist. */
  version: string;
  maxDelegationDepth: number;
  rules: Rule[];
}

export type ReasonCategory =
  | "rule_match"
  | "no_matching_rule"
  | "delegation_depth_exceeded"
  | "missing_case_context"
  | "case_mismatch";

export interface Decision {
  allowed: boolean;
  reasonCategory: ReasonCategory;
  policyVersion: string;
}

/** Die Matrix ist Konfiguration, kein Code. Sie liegt als JSON neben dieser Datei. */
export function loadMatrix(
  url: URL = new URL("./matrix.json", import.meta.url),
): PolicyMatrix {
  return JSON.parse(readFileSync(url, "utf8")) as PolicyMatrix;
}

// #region authz-check
/**
 * Berechtigungsprüfung. Standard ist ablehnen: Erlaubt wird nur,
 * was alle Prüfungen besteht und in der Matrix steht.
 */
export function checkPermission(
  matrix: PolicyMatrix,
  target: string,
  request: AgentRequest,
  context: CallContext,
): Decision {
  const deny = (reasonCategory: ReasonCategory): Decision => ({
    allowed: false,
    reasonCategory,
    policyVersion: matrix.version,
  });

  // 1. Delegationstiefe: Ketten dürfen nicht beliebig lang werden.
  // #region authz-depth
  if (context.delegationChain.length > matrix.maxDelegationDepth) {
    return deny("delegation_depth_exceeded");
  }
  // #endregion authz-depth

  // 2. Matrix: Gibt es eine Regel für genau diese Kombination?
  // #region authz-rule
  const rule = matrix.rules.find(
    (r) =>
      r.caller === context.callerAgentId &&
      r.target === target &&
      r.action === request.action &&
      r.resourceType === request.resource.type,
  );
  if (!rule) {
    return deny("no_matching_rule");
  }
  // #endregion authz-rule

  // 3. Fallbezug: Ohne Fall kein Zugriff, und nur auf den eigenen Fall.
  // #region authz-case
  if (!context.caseId) {
    return deny("missing_case_context");
  }
  if (context.caseId !== request.resource.caseId) {
    return deny("case_mismatch");
  }
  // #endregion authz-case

  return { allowed: true, reasonCategory: "rule_match", policyVersion: matrix.version };
}
// #endregion authz-check
