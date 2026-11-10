/** Findet die Bereiche, die im Quelltext mit "// #region name" markiert sind. */
export interface Region {
  /** Erste und letzte Zeile des Bereichs, 1-basiert, ohne die Marker-Zeilen. */
  start: number;
  end: number;
}

export function parseRegions(source: string): Map<string, Region> {
  const regions = new Map<string, Region>();
  const open = new Map<string, number>();
  source.split("\n").forEach((line, index) => {
    const match = /\/\/ #(region|endregion) ([\w-]+)/.exec(line);
    if (!match) return;
    const [, kind, name] = match;
    if (kind === "region") {
      open.set(name!, index + 2);
    } else if (open.has(name!)) {
      regions.set(name!, { start: open.get(name!)!, end: index });
    }
  });
  return regions;
}

export const isMarkerLine = (line: string) => /^\s*\/\/ #(region|endregion) /.test(line);
