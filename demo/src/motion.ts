import { animate } from "animejs";

/** Nutzer mit "Bewegung reduzieren" bekommen Zustandswechsel ohne Animation. */
const query = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => query.matches;

/**
 * Laufende Animationen eines Bereichs. cancelAll() bricht alles ab und löst
 * die wartenden Promises auf, damit ein neues Szenario sofort starten kann.
 */
export function createMotion() {
  const running = new Set<{ cancel(): void }>();

  /** Animiert einen Wert von 0 nach 1 und meldet jeden Zwischenstand. */
  function tween(duration: number, onUpdate: (progress: number) => void, ease = "inOutQuad") {
    return new Promise<void>((resolve) => {
      if (reducedMotion()) {
        onUpdate(1);
        resolve();
        return;
      }
      const state = { progress: 0 };
      const entry = {
        cancel() {
          animation.cancel();
          running.delete(entry);
          resolve();
        },
      };
      const animation = animate(state, {
        progress: 1,
        duration,
        ease,
        onUpdate: () => onUpdate(state.progress),
        onComplete: () => {
          running.delete(entry);
          resolve();
        },
      });
      running.add(entry);
    });
  }

  /** Pause zwischen zwei Schritten. Ohne Animation etwas länger, damit man mitlesen kann. */
  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(done, ms);
      const entry = {
        cancel() {
          window.clearTimeout(timer);
          done();
        },
      };
      function done() {
        running.delete(entry);
        resolve();
      }
      running.add(entry);
    });
  }

  function cancelAll() {
    for (const entry of [...running]) entry.cancel();
  }

  return { tween, wait, cancelAll };
}
