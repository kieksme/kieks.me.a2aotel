import { InMemorySpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace";
import { modelFromEnv } from "./model/index.js";
import { scenarios } from "./scenarios.js";
import { startSystem } from "./system.js";
import { exporterFromEnv } from "./telemetry/setup.js";
import { formatTraceTree } from "./telemetry/tree.js";

/**
 * Startet ein Szenario:  pnpm scenario <name>   oder   pnpm scenario all
 */
const name = process.argv[2] ?? "all";
const selected = name === "all" ? Object.keys(scenarios) : [name];
if (selected.some((key) => !(key in scenarios))) {
  console.error(`Unbekanntes Szenario "${name}". Möglich: all, ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}

// Zusätzlich zum gewählten Exporter sammeln wir die Spans im Speicher,
// um am Ende eine kompakte Übersicht auszugeben.
const memory = new InMemorySpanExporter();
const configured = exporterFromEnv();
const exporters: SpanExporter[] = configured ? [memory, configured] : [memory];

const system = await startSystem({ exporters, model: await modelFromEnv() });
try {
  for (const key of selected) {
    const scenario = scenarios[key]!;
    memory.reset();
    const result = await system.submit(scenario.order);
    console.log(`\n=== ${scenario.title} ===`);
    console.log(`Erwartung: ${scenario.expectation}`);
    console.log(`Ergebnis:  ${JSON.stringify(result)}`);
    console.log(formatTraceTree(memory.getFinishedSpans()));
  }
} finally {
  await system.stop();
}
