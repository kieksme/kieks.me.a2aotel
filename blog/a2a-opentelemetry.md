# Wer hat hier wen gerufen? A2A-Agenten absichern und mit OpenTelemetry belegen

*Ein Beitrag der kieks.me GbR. Stand: 10. November 2026.*

Ein einzelner KI-Agent ist überschaubar. Du siehst die Anfrage, den Modellaufruf, die Antwort. Spannend wird es, sobald Agenten sich gegenseitig beauftragen: Agent A fragt Agent B, B fragt eine Datenquelle, vielleicht fragt B sogar bei A zurück.

Dann stehst du irgendwann vor einer Frage, die erstaunlich schwer zu beantworten ist: **Wer hat hier eigentlich wen gerufen, für welchen Fall, und durfte er das?**

In diesem Artikel zeigen wir dir ein Muster, das genau diese Frage beantwortet. Es ist plattformunabhängig. Microsoft Foundry taucht als Beispielplattform auf, das Beispielprojekt läuft aber komplett lokal.

- Repository: <https://github.com/kieksme/kieks.me.a2aotel>
- Online-Demo (Simulation): <https://kieksme.github.io/kieks.me.a2aotel/>

## Warum Agentenketten so schwer nachzuvollziehen sind

Jeder Agent ist ein eigener Dienst mit eigenen Logs. In einer Kette hast du also drei Logdateien und keine gemeinsame Klammer. Dazu kommen drei Eigenheiten von Agenten:

- **Der Ablauf ist nicht fest.** Welche Schritte ein Agent geht, hängt von der Eingabe ab.
- **Aufrufe sind verschachtelt.** Ein Agent ruft einen Agenten, der eine Datenquelle ruft.
- **Ein Nein hinterlässt oft keine Spur.** Wird ein Aufruf abgelehnt, steht das bestenfalls als Fehlerzeile in einem der Logs.

Für den Betrieb ist das lästig. Für Revision und Sicherheit ist es ein echtes Problem: Du kannst nicht belegen, was passiert ist.

## A2A einfach erklärt

Agent-to-Agent (A2A) ist ein offenes Protokoll, über das Agenten miteinander reden. Die Spezifikation liegt aktuell in Version 1.0.0 vor. Für den Einstieg reichen drei Bausteine.

**Die Agent Card.** Sie ist die maschinenlesbare Selbstbeschreibung eines Agenten: Name, Beschreibung, Schnittstellen, Fähigkeiten (Skills). Abrufbar ist sie unter `/.well-known/agent-card.json`. So sieht die Card des Dokumentenagenten in unserem Beispiel aus (`src/agents/dokumentenagent.ts`, gekürzt um den zweiten Skill):

```ts
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
      // ...
    ],
  };
}
```

**Der Aufruf.** Der Aufrufer schickt eine Nachricht, in der JSON-RPC-Bindung über die Methode `SendMessage`.

**Das Ergebnis.** Der Zielagent antwortet mit einer Nachricht oder einer Ablehnung.

Wichtig ist, was *nicht* dazugehört: Der Aufrufer sieht weder den internen Zustand noch das Gedächtnis noch die Tools des Zielagenten. Die Spezifikation nennt das „Opaque Execution". Der Zielagent bleibt eine Blackbox.

### Das Hotel-Bild

Stell dir ein Hotel vor. Du als **Gast** gibst an der Rezeption ein Hemd ab. Die **Wäscherei** des Hotels nimmt den Auftrag an. Für den Rotweinfleck beauftragt sie eine externe **Spezialreinigung**.

Du weißt nicht, welche Maschinen die Spezialreinigung nutzt, und musst es auch nicht wissen. Du kennst nur die Preisliste (die Agent Card), gibst den Auftrag ab und bekommst das Hemd zurück. An jedem Kleidungsstück hängt ein Zettel mit deiner Zimmernummer. Den Zettel merken wir uns, er kommt gleich als Fallbezug wieder.

### Und MCP?

Das Model Context Protocol (MCP) löst ein anderes Problem. Die A2A-Doku fasst es so: MCP ist vertikal und vertieft einen einzelnen Agenten, A2A ist horizontal und verbindet Agenten untereinander. MCP gibt einem Agenten also Tools und Daten. A2A lässt ihn mit anderen Agenten sprechen. In der Praxis nutzt du oft beides.

## Rechte und Identität: jede Kante einzeln

A2A regelt den Transport. Die Berechtigung überlässt das Protokoll ausdrücklich dir: Autorisierung ist laut Spezifikation „implementation-specific". Hier sind die Regeln, die sich bei uns bewährt haben.

1. **Jeder Agent hat seine eigene Identität.** Er meldet sich als er selbst an, nicht als der Mensch, der die Kette gestartet hat.
2. **Keine Token-Weitergabe.** Ein Agent reicht das Token seines Aufrufers nicht einfach durch. Sonst erbt die letzte Stufe alle Rechte der ersten.
3. **Jede Aufrufkante wird einzeln erlaubt.** Wer darf bei wem was auf welcher Ressource?
4. **Standard ist ablehnen.** Was nicht ausdrücklich erlaubt ist, ist verboten.
5. **Der Fallbezug reist mit.** Das ist der Zettel mit der Zimmernummer. Ohne Fall kein Zugriff, und nur auf den eigenen Fall.
6. **Die Delegationstiefe ist begrenzt.** Ketten dürfen nicht beliebig lang werden.

Im Beispiel stehen die erlaubten Kanten in einer Matrix. Das ist Konfiguration, kein Code (`src/authz/matrix.json`, Auszug):

```json
{
  "version": "2026-11-09.1",
  "maxDelegationDepth": 2,
  "rules": [
    {
      "caller": "sachbearbeitung",
      "target": "supportagent",
      "action": "cases.assess",
      "resourceType": "support-case"
    },
    {
      "caller": "supportagent",
      "target": "dokumentenagent",
      "action": "documents.read",
      "resourceType": "case-documents"
    }
  ]
}
```

Die Prüfung dazu ist kurz und in genau dieser Reihenfolge aufgebaut (`src/authz/policy.ts`, Auszug aus `checkPermission`):

```ts
  // 1. Delegationstiefe: Ketten dürfen nicht beliebig lang werden.
  if (context.delegationChain.length > matrix.maxDelegationDepth) {
    return deny("delegation_depth_exceeded");
  }

  // 2. Matrix: Gibt es eine Regel für genau diese Kombination?
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

  // 3. Fallbezug: Ohne Fall kein Zugriff, und nur auf den eigenen Fall.
  if (!context.caseId) {
    return deny("missing_case_context");
  }
  if (context.caseId !== request.resource.caseId) {
    return deny("case_mismatch");
  }

  return { allowed: true, reasonCategory: "rule_match", policyVersion: matrix.version };
```

Der Agentencode selbst enthält keine Berechtigungsprüfung. Die sitzt in einem Wrapper, der sich um jeden Agenten legt. Andere Agenten erreicht der Agent nur über diesen Wrapper, und der setzt Fallbezug und Delegationskette. Der Agent kann daran nichts ändern.

### Ehrlich bleiben: Was das Beispiel nicht zeigt

Die Punkte 1 und 2 sind im Beispiel nur als Muster angelegt. Es gibt dort **keine Authentifizierung**. Der Aufrufer nennt seine Agenten-ID selbst, deshalb lauschen die Server nur auf `127.0.0.1`.

In Produktion müssen Aufrufer-ID und Delegationskette aus einem geprüften Token kommen. Auf der Microsoft-Plattform ist dafür **Microsoft Entra Agent ID** gedacht. Laut Doku ist eine Agent Identity die Identität, mit der sich ein KI-Agent bei Systemen anmeldet, und sie wird aus einem Agent Identity Blueprint erzeugt. Für unser Muster passt ein Detail besonders gut: Eine neu angelegte Agent Identity startet in Foundry ohne Ressourcenrechte. Default Deny also auch auf Plattformebene.

## OpenTelemetry: aus drei Logs wird ein Trace

OpenTelemetry (OTel) liefert die fehlende Klammer. Vier Begriffe genügen:

- **Span:** eine Arbeitseinheit, zum Beispiel ein Agentenaufruf. Spans sind die Bausteine eines Trace.
- **Trace-ID:** die gemeinsame Kennung aller Spans eines Laufs. Sie ist unsere Lauf-ID über alle Stufen.
- **Eltern-Referenz:** Jeder Span kennt die ID seines Eltern-Spans. Nur beim Wurzel-Span ist sie leer. So entsteht der Baum.
- **Trace-Kontext:** Damit die Trace-ID über Dienstgrenzen hinweg erhalten bleibt, reist sie im HTTP-Header `traceparent` mit. Das Format stammt aus der W3C-Empfehlung „Trace Context": `<version>-<trace-id>-<parent-id>-<trace-flags>`.

Die A2A-Spezifikation schreibt dazu nichts vor. Den Header mitzuschicken ist eine Ergänzung unseres Beispiels, und sie besteht aus zwei kleinen Stellen im Wrapper (`src/telemetry/wrapper.ts`).

Ausgehend, beim Aufrufer:

```ts
      // Trace-Kontext als traceparent-Header mitschicken. Ohne diesen
      // Schritt würde beim Zielagenten ein neuer Trace beginnen.
      const headers: Record<string, string> = {};
      propagator.inject(trace.setSpan(parent, span), headers, defaultTextMapSetter);
```

Eingehend, beim Zielagenten:

```ts
    // Trace-Kontext aus dem traceparent-Header lesen. Dadurch hängt
    // dieser Span am Span des Aufrufers und behält dessen Trace-ID.
    const parent = propagator.extract(ROOT_CONTEXT, headers, defaultTextMapGetter);
```

Für die Benennung gibt es die **GenAI Semantic Conventions** von OpenTelemetry. Sie liegen inzwischen in einem eigenen Repository. Ein Agentenaufruf heißt dort `invoke_agent {gen_ai.agent.name}`, dazu kommen Attribute wie `gen_ai.operation.name` und `gen_ai.agent.id`. Zwei Hinweise dazu:

- Die Konventionen haben den Status **„Development"** und können sich ändern.
- Für Berechtigungsentscheidungen gibt es **keine Konvention**. Das Beispiel nutzt dafür einen eigenen Namensraum `app.`.

### Wie das in Foundry aussieht

Microsoft Foundry setzt auf dieselben Bausteine. Laut Doku speichert Foundry Traces in **Azure Monitor Application Insights** und nutzt dafür die OpenTelemetry-Konventionen. Für Prompt-Agenten und gehostete Agenten im **Foundry Agent Service** entstehen serverseitige Traces ohne Codeänderung, sobald Application Insights mit dem Projekt verbunden ist. Clientseitiges Tracing im eigenen Code ist aktuell als Preview gekennzeichnet.

Deine Spans landen also in der Traces-Ansicht des Foundry-Portals statt in Jaeger. Das Muster bleibt gleich.

### Rechte verhindern, Tracing belegt

Das ist der Kern des Ganzen. Rechte und Tracing sind zwei verschiedene Werkzeuge:

- **Rechte verhindern.** Die Matrix sorgt dafür, dass ein unzulässiger Aufruf gar nicht erst ausgeführt wird.
- **Tracing belegt.** Der Trace zeigt hinterher, was passiert ist, und zwar auch das Nein.

Tracing allein schützt nichts. Rechte allein beweisen nichts. Erst zusammen kannst du sagen: Das war verboten, es wurde verhindert, und hier ist der Nachweis.

## Praxisbeispiel: Supportagent ruft Dokumentenagent

Im Repository bearbeitet ein **Supportagent** einen Supportfall. Die Dokumente holt er sich vom **Dokumentenagenten**, der dafür auf eine Dokumenten-API zugreift. Alle Daten sind erfunden.

Zum Selbstausprobieren brauchst du Node.js 20 oder neuer und pnpm:

```bash
pnpm install
```

```bash
TRACE_EXPORTER=none pnpm scenario allowed
```

### Der erlaubte Aufruf

Der Supportagent fragt die Dokumente seines eigenen Falls an. Die Ausgabe zeigt den Trace als Baum:

```
=== Erlaubter Aufruf ===
Trace-ID 15adbbbec688800e40563526668a67c0
✓ [supportagent] invoke_agent supportagent (8.0 ms) allowed: rule_match
  ✓ [supportagent] invoke_agent dokumentenagent (6.8 ms) allowed
    ✓ [dokumentenagent] invoke_agent dokumentenagent (1.0 ms) allowed: rule_match
      ✓ [dokumenten-api] documents.list (0.1 ms)
  ✓ [supportagent] chat mock-model (0.1 ms)
```

Drei Dienste, eine Trace-ID. Die Einrückung ist die Eltern-Referenz: Du siehst auf einen Blick, wer wen gerufen hat.

### Der verweigerte Aufruf

Im Szenario `foreign-case` fragt der Supportagent Dokumente eines fremden Falls an:

```bash
TRACE_EXPORTER=none pnpm scenario foreign-case
```

```
=== Fremde Fall-ID ===
Trace-ID c0e5443e9018b621982b099138beb061
✓ [supportagent] invoke_agent supportagent (7.2 ms) allowed: rule_match
  ✗ [supportagent] invoke_agent dokumentenagent (6.3 ms) denied: case_mismatch
    ✗ [dokumentenagent] invoke_agent dokumentenagent (0.2 ms) denied: case_mismatch
```

Der Dokumentenagent läuft gar nicht erst, die Dokumenten-API wird nie berührt. Die Ablehnung ist trotzdem sichtbar, und zwar von beiden Seiten der Kante. Dafür sorgt diese Stelle im Wrapper:

```ts
      // Erst prüfen, dann ausführen. Die Entscheidung kommt immer in den
      // Span, mit Begründungskategorie und Regelversion.
      const decision = checkPermission(matrix, agentId, request, callContext);
      span.setAttributes({
        "app.authz.decision": decision.allowed ? "allowed" : "denied",
        "app.authz.reason": decision.reasonCategory,
        "app.authz.policy_version": decision.policyVersion,
      });
```

Die Regelversion im Span ist Absicht. So kannst du auch in einem halben Jahr noch sagen, nach welchem Stand der Matrix entschieden wurde.

### Was im Trace steht und was nicht

Im Span stehen: Aufrufer und Ziel, Aktion und Ressourcentyp, Entscheidung, Begründungskategorie, Regelversion, Freigabereferenz und Delegationsstufe.

**Nicht** im Span stehen: Tokens, Prompts, Modellantworten, Dokumentinhalte und Fall-IDs im Klartext. Ein Test im Repository prüft das. Statt der Fall-ID landet eine pseudonymisierte Referenz im Trace (`src/telemetry/pseudonym.ts`):

```ts
  return (caseId) =>
    "case_" + createHmac("sha256", salt).update(caseId).digest("hex").slice(0, 12);
```

Gleiche Fälle bleiben so zuordenbar, ohne dass die echte ID im Trace steht. Das Salt kommt aus der Umgebung und steht nie im Code. Und trotzdem gilt: Traces sind Betriebsdaten. Für sie gelten dieselben Zugriffs- und Aufbewahrungsregeln wie für Logs.

### Die Online-Demo

Wenn du nichts installieren willst, klick dich durch die [Online-Demo](https://kieksme.github.io/kieks.me.a2aotel/). Sie ist eine **Simulation**: Es laufen keine Agenten, Abläufe und Traces sind gemockt. Der angezeigte Code ist dagegen echt und wird direkt aus `src/` eingebunden.

Am lehrreichsten ist der Schalter, der den Wrapper ausschaltet. Dann geht der unzulässige Aufruf durch, und im Trace fehlt jede Spur davon.

Das Repository enthält drei weitere Szenarien: die dritte Delegationsstufe (`third-level`), einen Auftrag ohne Fallbezug (`no-case`) und ein Dokument mit eingeschleuster Anweisung (`injection`).

## Fazit: drei Merksätze

1. **Jede Aufrufkante wird einzeln erlaubt, alles andere ist verboten.**
2. **Rechte entstehen nie aus Inhalten, nur aus der Matrix.** Ein Dokument kann einem Agenten nichts erlauben.
3. **Rechte verhindern, Tracing belegt.** Auch das Nein steht im Trace.

### Ausblick

Das Beispiel ist bewusst klein und hat klare Grenzen. Für den Weg in die Produktion stehen drei Schritte an:

- **Echte Agentenidentität:** Aufrufer und Delegationskette aus geprüften Tokens statt aus dem Request, zum Beispiel mit Microsoft Entra Agent ID.
- **Offizielles A2A-SDK:** Das Beispiel ist A2A-ähnlich, aber keine vollständige, konforme Implementierung.
- **Konventionen im Blick behalten:** Die GenAI-Konventionen sind noch im Status „Development". Plane ein, Attributnamen nachzuziehen.

Der Trade-off ist überschaubar: Ein zentraler Wrapper kostet dich etwas Disziplin, denn kein Agent darf an ihm vorbei. Dafür bekommst du Berechtigung und Nachweis an genau einer Stelle, statt in jedem Agenten neu.

## Quellen

- OpenTelemetry, Traces: <https://opentelemetry.io/docs/concepts/signals/traces/>
- OpenTelemetry, Context Propagation: <https://opentelemetry.io/docs/concepts/context-propagation/>
- W3C Trace Context (Recommendation, 23.11.2021): <https://www.w3.org/TR/trace-context/>
- OpenTelemetry GenAI Semantic Conventions, Agent Spans: <https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md>
- A2A-Spezifikation: <https://a2a-protocol.org/latest/specification/>
- A2A und MCP: <https://a2a-protocol.org/latest/topics/a2a-and-mcp/>
- Microsoft Foundry, Agent tracing overview: <https://learn.microsoft.com/azure/foundry/observability/concepts/trace-agent-concept>
- Microsoft Foundry, Tracing einrichten: <https://learn.microsoft.com/azure/foundry/observability/how-to/trace-agent-setup>
- Microsoft Foundry, Agent identity concepts: <https://learn.microsoft.com/azure/foundry/agents/concepts/agent-identity>
- Microsoft Entra Agent ID: <https://learn.microsoft.com/entra/agent-id/what-is-microsoft-entra-agent-id>
- Beispiel-Repository: <https://github.com/kieksme/kieks.me.a2aotel>
- Online-Demo: <https://kieksme.github.io/kieks.me.a2aotel/>

> **Prüfhinweis:** Produktnamen, SDK-Pakete, Rollennamen und Preview-Kennzeichnungen stammen aus der Doku mit Stand 10. November 2026. Sie ändern sich schnell und müssen vor der Veröffentlichung gegengeprüft werden. Das gilt besonders für die GenAI-Konventionen (Status „Development"), die A2A-Version und die Foundry-Funktionen. Die Code-Auszüge entsprechen dem Stand des Repositorys zum selben Datum.
