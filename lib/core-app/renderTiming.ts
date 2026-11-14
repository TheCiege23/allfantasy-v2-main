/**
 * Per-read timing for slow server renders, so "the league page takes 7 seconds" can be
 * answered with WHICH read took them.
 *
 * Railway's tracing is eBPF/HTTP-only: it shows a `/core` RSC request taking 7.1s with its
 * first byte at 0.39s, and nothing about the ~30 reads behind the screen boundary. This fills
 * that gap with one log line per SLOW render only:
 *
 *   [render-timing] {"scope":"league-home","totalMs":2310,"reads":{"teams":41,"trades":1890,…}}
 *
 * `time(label, promise)` records how long that read took from the moment it was handed over
 * (start reads, then hand them over, so the figure is the read's own duration even when several
 * run at once). `lap(label)` records the wall-clock gap since the previous lap, for code that
 * still runs in sequence. Diagnostics must never fail a render, so nothing here throws.
 */

export type RenderTimer = {
  time<T>(label: string, read: Promise<T>): Promise<T>
  lap(label: string): void
  done(extra?: Record<string, unknown>): void
}

const DEFAULT_THRESHOLD_MS = 1500

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

export function createRenderTimer(scope: string, thresholdMs = DEFAULT_THRESHOLD_MS): RenderTimer {
  const startedAt = now()
  let lastLap = startedAt
  const reads: Record<string, number> = {}
  const laps: Record<string, number> = {}
  let finished = false

  return {
    time(label, read) {
      const t0 = now()
      const record = () => {
        try {
          reads[label] = Math.round(now() - t0)
        } catch {
          /* diagnostics cannot fail a render */
        }
      }
      read.then(record, record)
      return read
    },
    lap(label) {
      try {
        const t = now()
        laps[label] = Math.round((laps[label] ?? 0) + (t - lastLap))
        lastLap = t
      } catch {
        /* diagnostics cannot fail a render */
      }
    },
    done(extra) {
      if (finished) return
      finished = true
      try {
        const totalMs = Math.round(now() - startedAt)
        if (totalMs < thresholdMs) return
        console.info('[render-timing]', JSON.stringify({ scope, totalMs, ...extra, reads, laps }))
      } catch {
        /* diagnostics cannot fail a render */
      }
    },
  }
}
