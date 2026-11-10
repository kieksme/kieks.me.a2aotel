import { createHmac, randomBytes } from "node:crypto";

// #region pseudonym
/**
 * Macht aus einer Fall-ID eine pseudonymisierte Fallreferenz für Spans.
 * Im Trace steht damit nie die echte Fall-ID, gleiche Fälle bleiben aber
 * über den Hash zuordenbar.
 *
 * Das Salt kommt aus der Umgebung (CASE_REF_SALT). Fehlt es, wird pro
 * Prozess ein zufälliges erzeugt. Es steht nie im Code.
 */
export function createPseudonymizer(
  salt: string = process.env.CASE_REF_SALT ?? randomBytes(32).toString("hex"),
): (caseId: string) => string {
  return (caseId) =>
    "case_" + createHmac("sha256", salt).update(caseId).digest("hex").slice(0, 12);
}
// #endregion pseudonym
