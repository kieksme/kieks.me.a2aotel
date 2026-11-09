import { describe, expect, it } from "vitest";
import type { AgentRequest, CallContext } from "../src/a2a/types.js";
import { checkPermission, loadMatrix } from "../src/authz/policy.js";

const matrix = loadMatrix();

const request: AgentRequest = {
  action: "documents.read",
  resource: { type: "case-documents", caseId: "SUP-2026-0042" },
};
const context: CallContext = {
  callerAgentId: "supportagent",
  caseId: "SUP-2026-0042",
  approvalRef: "FRG-2026-0001",
  delegationChain: ["sachbearbeitung", "supportagent"],
};

describe("checkPermission", () => {
  it("erlaubt, was in der Matrix steht und zum Fall passt", () => {
    expect(checkPermission(matrix, "dokumentenagent", request, context)).toEqual({
      allowed: true,
      reasonCategory: "rule_match",
      policyVersion: matrix.version,
    });
  });

  it("lehnt standardmäßig ab, wenn keine Regel passt", () => {
    const unknownAction = { ...request, action: "documents.delete" };
    expect(checkPermission(matrix, "dokumentenagent", unknownAction, context)).toMatchObject({
      allowed: false,
      reasonCategory: "no_matching_rule",
    });

    const unknownCaller = { ...context, callerAgentId: "fremder-agent" };
    expect(checkPermission(matrix, "dokumentenagent", request, unknownCaller)).toMatchObject({
      allowed: false,
      reasonCategory: "no_matching_rule",
    });
  });

  it("lehnt bei leerer Matrix alles ab", () => {
    const empty = { version: "leer", maxDelegationDepth: 2, rules: [] };
    expect(checkPermission(empty, "dokumentenagent", request, context).allowed).toBe(false);
  });

  it("lehnt eine fremde Fall-ID ab", () => {
    const foreign = { ...request, resource: { ...request.resource, caseId: "SUP-2026-0099" } };
    expect(checkPermission(matrix, "dokumentenagent", foreign, context)).toMatchObject({
      allowed: false,
      reasonCategory: "case_mismatch",
    });
  });

  it("lehnt ohne Fallbezug ab", () => {
    const noCase = { ...context, caseId: undefined };
    expect(checkPermission(matrix, "dokumentenagent", request, noCase)).toMatchObject({
      allowed: false,
      reasonCategory: "missing_case_context",
    });
  });

  it("lehnt die dritte Delegationsstufe ab, auch wenn eine Regel existiert", () => {
    const clarify: AgentRequest = {
      action: "cases.clarify",
      resource: { type: "support-case", caseId: "SUP-2026-0042" },
    };
    const third: CallContext = {
      ...context,
      callerAgentId: "dokumentenagent",
      delegationChain: ["sachbearbeitung", "supportagent", "dokumentenagent"],
    };
    expect(checkPermission(matrix, "supportagent", clarify, third)).toMatchObject({
      allowed: false,
      reasonCategory: "delegation_depth_exceeded",
    });
    // Gegenprobe: Bei Stufe 2 greift dieselbe Regel.
    const second = { ...third, delegationChain: ["sachbearbeitung", "dokumentenagent"] };
    expect(checkPermission(matrix, "supportagent", clarify, second).allowed).toBe(true);
  });
});
