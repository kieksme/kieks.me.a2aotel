# kieks.me.a2aotel

Beispielprojekt der kieks.me GbR: Zwei KI-Agenten rufen sich gegenseitig auf (Agent-to-Agent, A2A). Jeder Aufruf wird auf Berechtigung geprüft und mit OpenTelemetry nachvollziehbar gemacht.

Die Kernidee: **Rechte verhindern, Tracing belegt.** Ein Wrapper um jeden Agenten prüft vor der Ausführung, ob der Aufruf erlaubt ist, und schreibt die Entscheidung in einen Span. Auch eine Ablehnung ist damit im Trace sichtbar.

Das Muster ist plattformunabhängig. Microsoft Foundry ist als optionale Variante für die Modellanbindung enthalten.

> Alle Daten sind erfunden. Es gibt keine echten Kunden und keine personenbezogenen Daten.

Das Repository hat zwei Teile:

- **Teil A, das echte Beispiel** (`src/`): lauffähige Agenten zum Selbstausprobieren.
- **Teil B, die Online-Demo** (`demo/`): eine statische Seite, die denselben Ablauf als Simulation zeigt. Sie braucht kein Backend, kein Modell und keine API-Keys.

## Das Beispiel

Ein **Supportagent** bearbeitet einen Supportfall. Die Dokumente zum Fall holt er sich vom **Dokumentenagenten**, der dafür auf die **Dokumenten-API** zugreift.

| Szenario | Was passiert | Ergebnis |
|---|---|---|
| `allowed` | Supportagent fragt Dokumente seines Falls an | erlaubt |
| `foreign-case` | Supportagent fragt Dokumente eines fremden Falls an | verweigert: `case_mismatch` |
| `third-level` | Dokumentenagent will eine Rückfrage weiterdelegieren (Stufe 3) | verweigert: `delegation_depth_exceeded` |
| `injection` | Ein Dokument enthält eine Anweisung zur Rechteausweitung | markiert und ignoriert |
| `no-case` | Auftrag ohne Fallbezug | verweigert: `missing_case_context` |

## Architektur

```
 Sachbearbeitung (CLI / Test)                               Stufe 0
        │  Auftrag zu einem Fall, mit Freigabereferenz
        ▼
┌──────────────────┐  A2A SendMessage + traceparent  ┌──────────────────────┐
│  Supportagent    │ ──────────────────────────────▶ │  Dokumentenagent     │
│  (Stufe 1)       │ ◀────────────────────────────── │  (Stufe 2)           │
│                  │      Ergebnis / Ablehnung       │                      │
│ ┌──────────────┐ │                                 │ ┌──────────────────┐ │
│ │ Wrapper      │ │                                 │ │ Wrapper          │ │
│ └──────────────┘ │                                 │ │ 1 Kontext lesen  │ │
│  Modell-Provider │                                 │ │ 2 Span öffnen    │ │
│  (mock/Ollama/   │                                 │ │ 3 Berechtigung   │ │
│   API/Foundry)   │                                 │ │   (default deny) │ │
└──────────────────┘                                 │ │ 4 Agent aufrufen │ │
                                                     │ └──────────────────┘ │
                                                     └──────────┬───────────┘
                                                                │ nur wenn erlaubt
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │ Dokumenten-API       │
                                                     │ (Beispieldaten)      │
                                                     └──────────────────────┘

 Spans  ──▶  Konsole  oder  OTLP ──▶ Jaeger (Docker Compose, lokal)
```

Der Wrapper (`src/telemetry/wrapper.ts`) liegt um beide Agenten:

1. **Trace-Kontext:** Er liest den `traceparent`-Header des Aufrufers und gibt ihn bei eigenen Aufrufen weiter. So entsteht eine durchgehende Trace-ID über alle Dienste.
2. **Berechtigung:** Er prüft jeden eingehenden Aufruf gegen die Matrix (`src/authz/matrix.json`). Standard ist ablehnen.
3. **Nachweis:** Er schreibt pro Aufruf einen Span mit Aufrufer, Aktion, Ressource, Entscheidung, Begründungskategorie und Regelversion.

Der Agentencode enthält selbst keine Berechtigungsprüfung. Andere Agenten erreicht er nur über den Wrapper, der Fallbezug und Delegationskette setzt.

## Schnellstart

Voraussetzungen: Node.js 20 oder neuer, pnpm.

```bash
pnpm install
```

```bash
pnpm scenario all
```

Ein einzelnes Szenario, ohne die ausführliche Span-Ausgabe:

```bash
TRACE_EXPORTER=none pnpm scenario foreign-case
```

Die Ausgabe zeigt Ergebnis und Trace als Baum:

```
=== Fremde Fall-ID ===
Trace-ID f96d0edcf16c33caa036af503b97bcd5
✓ [supportagent] invoke_agent supportagent (2.6 ms) allowed: rule_match
  ✗ [supportagent] invoke_agent dokumentenagent (2.4 ms) denied: case_mismatch
    ✗ [dokumentenagent] invoke_agent dokumentenagent (0.1 ms) denied: case_mismatch
```

Tests und Typprüfung:

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Traces in Jaeger ansehen

```bash
docker compose up -d
```

```bash
TRACE_EXPORTER=otlp pnpm scenario all
```

Danach http://localhost:16686 öffnen und den Dienst `supportagent` wählen. Verweigerte Aufrufe sind als Fehler markiert.

```bash
docker compose down
```

## Online-Demo

Die Demo ist eine **Simulation**. Es laufen keine Agenten, Abläufe und Traces sind gemockt. Der angezeigte Code ist dagegen echt: Die Seite bindet die Dateien aus `src/` direkt ein, es gibt keine zweite Kopie.

```bash
pnpm demo
```

Was die Demo zeigt:

- Vorgefertigte Nachrichten zum Anklicken, der Ablauf wird animiert (anime.js).
- Eine Trace-Ansicht im Stil von Jaeger mit aufklappbaren Spans.
- Die Verknüpfung in beide Richtungen: Ein Klick auf einen Span hebt den Teil im Ablauf hervor, ein Klick im Ablauf markiert die Spans.
- Einen Schalter, der den Wrapper ausschaltet. Dann geht der unzulässige Aufruf durch und im Trace fehlt jede Spur.
- Die Agent Card jedes Agenten und den Code, mit Markierung der gerade aktiven Stelle.
- Die Nachricht, die gerade unterwegs ist: Anfrage mit `traceparent` und Aufrufkontext, Antwort und den Prompt ans Modell. Über das Briefsymbol an einem Schritt lässt sie sich später wieder aufrufen.
- Einen Vergleich derselben Anfrage mit und ohne Fallbezug.
- Den Trace als JSON-Download im OTLP-Format.
- Die Oberfläche auf Deutsch, Englisch und Chinesisch.

### Sprachen

Die Demo gibt es auf Deutsch, Englisch und Chinesisch (vereinfacht). Die Sprache wird so gewählt:

1. über die Adresse, zum Beispiel `?lang=en`
2. sonst die zuletzt selbst gewählte Sprache (im Browser gespeichert)
3. sonst die erste unterstützte Sprache aus den Browsereinstellungen
4. sonst Englisch

Oben rechts auf der Seite lässt sich die Sprache jederzeit umstellen. Die Texte liegen in `demo/src/i18n/`. `de.ts` legt die Schlüssel fest, `en.ts` und `zh.ts` müssen dieselben Schlüssel haben, sonst schlägt die Typprüfung fehl. Für eine weitere Sprache eine Datei ergänzen und in `detect.ts` und `index.ts` eintragen.

Nicht übersetzt sind die Kommentare im angezeigten Code und die Inhalte der Agent Card. Beides kommt unverändert aus dem Repository, die Demo weist darauf hin.

Die Markierung im Code hängt an Kommentaren wie `// #region authz-check` in den Quelldateien. Ein Test prüft, dass jede in der Demo verwendete Stelle im Quelltext existiert.

### Bauen und veröffentlichen

```bash
pnpm demo:build
```

Das Ergebnis liegt in `dist/` und ist eine rein statische Seite mit relativen Pfaden. Sie läuft auf GitHub Pages genauso wie auf einem eigenen Webserver.

Der Workflow `.github/workflows/pages.yml` veröffentlicht die Demo bei jedem Push auf `main` auf GitHub Pages. Dafür muss einmalig in den Repository-Einstellungen unter **Settings → Pages** als Quelle **GitHub Actions** gewählt werden.

### Hosting auf einem eigenen Server

Den Inhalt von `dist/` auf einen beliebigen statischen Webserver kopieren. Die Seite lädt nichts von fremden Servern und braucht keine Cookies. Wer eine Content Security Policy setzt: Skripte kommen nur von der eigenen Adresse (`script-src 'self'`), für die Syntax-Hervorhebung sind Inline-Styles nötig (`style-src 'self' 'unsafe-inline'`).

Zum lokalen Ansehen des Builds:

```bash
pnpm demo:preview
```

## Konfiguration

Alle Einstellungen kommen aus Umgebungsvariablen, siehe `.env.example`.

| Variable | Bedeutung | Standard |
|---|---|---|
| `TRACE_EXPORTER` | `console`, `otlp` oder `none` | `console` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Ziel für `otlp` | `http://localhost:4318` |
| `CASE_REF_SALT` | Salt für die pseudonymisierte Fallreferenz | zufällig pro Lauf |
| `MODEL_PROVIDER` | `mock`, `ollama`, `openai-compatible` oder `foundry` | `mock` |

### Modellanbindung

Die Agenten kennen nur die Schnittstelle `ModelProvider` (`src/model/provider.ts`). Der Anbieter ist austauschbar:

- **mock** (Standard): feste Antwort, kein Netzwerk, keine Kosten.
- **ollama**: lokales Ollama über dessen OpenAI-kompatible Schnittstelle. `MODEL_NAME` setzen, das Modell vorher mit `ollama pull` laden.
- **openai-compatible**: beliebiger API-Anbieter mit `/chat/completions`. Braucht `MODEL_BASE_URL`, `MODEL_NAME` und `MODEL_API_KEY`.
- **foundry** (optional): Microsoft Foundry über `@azure/ai-projects`. Die Anmeldung läuft über Microsoft Entra ID mit `DefaultAzureCredential`, zum Beispiel nach `az login`. Es gibt keinen API-Key. Nötig sind `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_MODEL_NAME` und die Rolle **Foundry User** auf dem Projekt.

Nur der Mock-Anbieter ist durch Tests abgedeckt. Die anderen Anbieter brauchen ein laufendes Modell und sind hier nicht automatisiert getestet.

## Was im Span steht

| Attribut | Inhalt |
|---|---|
| `gen_ai.operation.name`, `gen_ai.agent.id`, `gen_ai.agent.name` | nach den GenAI-Konventionen von OpenTelemetry |
| `app.caller.agent_id`, `app.target.agent_id` | wer ruft wen auf |
| `app.authz.action`, `app.authz.resource` | was wird angefragt |
| `app.case.ref` | pseudonymisierte Fallreferenz (HMAC, gekürzt) |
| `app.authz.decision` | `allowed` oder `denied` |
| `app.authz.reason` | Begründungskategorie, z. B. `case_mismatch` |
| `app.authz.policy_version` | Version der Berechtigungsmatrix |
| `app.approval.ref` | Freigabereferenz der auslösenden Stelle |
| `app.delegation.depth` | Delegationsstufe |

Nicht im Span: Tokens, Prompts, Modellantworten, Dokumentinhalte, Fall-IDs im Klartext. Ein Test prüft das.

Die `gen_ai.*`-Konventionen haben den Status „Development" und können sich ändern. Für Berechtigungsentscheidungen gibt es keine Konvention, deshalb der eigene Namensraum `app.`.

## Projektstruktur

```
src/
├── agents/        Supportagent und Dokumentenagent (Definition + Agent Card)
├── a2a/           Agent-Card-Typen, Client und Server (A2A-ähnlich)
├── authz/         Berechtigungsprüfung und Matrix (matrix.json)
├── telemetry/     Wrapper, Tracer-Setup, Pseudonymisierung
├── model/         Modellanbieter: mock, openai-compatible, foundry
├── data/          Dokumenten-API mit Beispieldaten
├── scenarios.ts   Szenarien für CLI und Tests
├── system.ts      startet und verdrahtet alles
└── cli.ts         pnpm scenario <name>
test/              Vitest
demo/              Online-Demo (Vite, statisch)
```

## Grenzen des Beispiels

- **A2A-ähnlich, nicht konform.** Agent Card, `SendMessage` und der Well-Known-Pfad orientieren sich an A2A 1.0. Es ist aber nur ein Ausschnitt. Für produktive Systeme das offizielle SDK nutzen.
- **Keine Authentifizierung.** Der Aufrufer nennt seine Agenten-ID und die Delegationskette selbst. In Produktion müssen beide aus einem geprüften Token kommen, zum Beispiel über eine Agentenidentität wie Microsoft Entra Agent ID. Die Server lauschen deshalb nur auf `127.0.0.1`.
- **Die Erkennung von Anweisungen in Dokumenten ist eine einfache Heuristik.** Der eigentliche Schutz ist die Matrix: Rechte entstehen nie aus Inhalten.
- **Ein Prozess.** Beide Agenten laufen im selben Prozess, reden aber über HTTP miteinander. Der Trace-Kontext reist also wirklich im Header.

## Sicherheit

- **Keine Secrets im Repository.** Zugangsdaten kommen nur aus Umgebungsvariablen, `.env` ist in `.gitignore`. Die Foundry-Variante nutzt die Entra-Anmeldung und braucht keinen API-Key.
- **Nur Beispieldaten.** Fälle, Dokumente und Referenzen sind erfunden.
- **Abhängigkeiten.** Alle Versionen sind fest gepinnt, die CI führt `pnpm audit` aus, Dependabot meldet Updates für npm-Pakete und GitHub Actions.
- **Lokaler Betrieb.** Agenten und Jaeger sind nur an `127.0.0.1` gebunden.
- **Traces sind Betriebsdaten.** In Produktion gelten für sie dieselben Zugriffs- und Aufbewahrungsregeln wie für Logs.

## Prüfhinweise

Vor einer Veröffentlichung oder nach Änderungen lohnt sich dieser Durchgang:

1. `pnpm test`, `pnpm typecheck` und `pnpm demo:build` laufen ohne Fehler.
2. `pnpm scenario all` zeigt bei `foreign-case`, `third-level` und `no-case` eine Ablehnung, bei `allowed` und `injection` keine.
3. Mit `docker compose up -d` und `TRACE_EXPORTER=otlp pnpm scenario all` erscheinen die Traces in Jaeger, je Szenario unter einer Trace-ID.
4. In der Demo lässt sich alles per Tastatur bedienen: Nachrichten, Schalter, Agenten und Pfeile im Ablauf, Spans, Dateireiter, Agent Card.
5. Mit der Systemeinstellung „Bewegung reduzieren“ läuft die Demo ohne Flug-Animation durch.

Bisher nicht geprüft und deshalb offen:

- Jaeger über Docker Compose. Getestet ist nur der OTLP-Export gegen einen lokalen Empfänger.
- Die Modellanbieter Ollama, OpenAI-kompatibel und Foundry gegen ein echtes Modell.
- Die Demo mit einem Screenreader.

### Stand der Doku

Produktnamen, Pakete und Rollen stammen aus der Doku mit Stand 10. November 2026. Sie ändern sich schnell und sollten vor einer Veröffentlichung gegengeprüft werden:

| Thema | Quelle | Übernommen |
|---|---|---|
| OpenTelemetry GenAI | [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) | Span-Name `invoke_agent {name}`, `gen_ai.*`-Attribute. Status „Development“. |
| OpenTelemetry JS | [opentelemetry.io/docs/languages/js](https://opentelemetry.io/docs/languages/js/) | `@opentelemetry/sdk-trace` 3.1.1, Trace-Kontext über `traceparent`. |
| A2A | [a2a-protocol.org](https://a2a-protocol.org/latest/specification/) | Version 1.0, Agent-Card-Felder, `SendMessage`, Well-Known-Pfad. |
| anime.js | [animejs.com/documentation](https://animejs.com/documentation/) | Version 4.5.0, `animate` aus `animejs`. |
| Jaeger | [jaegertracing.io](https://www.jaegertracing.io/docs/latest/getting-started/) | Image `jaegertracing/jaeger:2.23.0`. |
| Microsoft Foundry | [learn.microsoft.com/azure/foundry](https://learn.microsoft.com/azure/foundry/) | `@azure/ai-projects`, `DefaultAzureCredential`, Rolle „Foundry User“. |
| Microsoft Entra Agent ID | [learn.microsoft.com/entra/agent-id](https://learn.microsoft.com/entra/agent-id/) | Nur als Einordnung: Agentenidentität für geprüfte Aufrufer in Produktion. |

## Lizenz

MIT, siehe [LICENSE](LICENSE).
