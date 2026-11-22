/**
 * The rail's matchup scores wait for the home cards before they start building (owner's OK, 2026-11-22).
 *
 * WHY. Since the shell stopped waiting for the rail (#4076), the rail's projection boards and the home's cards were
 * built at the same moment on one web process. Measured on the owner's 91-league cold open (20:01Z 11-22): first
 * paint under 2.5s, but the server was 90–95% busy for the whole open and every card got slower — the home summary
 * 9.9s, the trades card 11.7s — while 64 boards were rebuilt beside them. The cards are what the owner reads first;
 * the rail's scores can arrive a moment later.
 *
 * ⚠ ONLY THE CROSS-LEAGUE HOME WAITS. Every other screen that shows this week's lineups awaits the same read inside
 * its own boundary (`CoreScreenBody` → `weekLineupsRead`), so making the rail wait for that screen would deadlock
 * it. The league-first landing waits for the rail before redirecting, so it never gates either.
 *
 * ⚠ THE GATE ALWAYS OPENS. `release` is called by the home once its heavy cards settle — success or failure. If it
 * is never called (the screen threw before it got there, the visitor left), the gate opens on its own after
 * `RAIL_AFTER_CARDS_MAX_WAIT_MS`, so the rail is never left without scores.
 */
export const RAIL_AFTER_CARDS_MAX_WAIT_MS = 20_000

export type RailGate = {
  /** Resolves when the rail may start: the cards have settled, or the wait ran out. Never rejects. */
  opened: Promise<void>
  /** Open the gate once `cards` settle, whatever they settle to. Safe to call more than once. */
  releaseAfter: (cards: Promise<unknown>) => void
}

export function createRailGate(maxWaitMs: number = RAIL_AFTER_CARDS_MAX_WAIT_MS): RailGate {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  const timer = setTimeout(() => open(), Math.max(0, maxWaitMs))
  // A pending gate must never keep a process (or a test run) alive on its own.
  ;(timer as { unref?: () => void }).unref?.()
  opened.then(() => clearTimeout(timer))
  return {
    opened,
    releaseAfter: (cards) => {
      cards.then(() => open(), () => open())
    },
  }
}

/** A gate that is open from the start — every screen except the cross-league home. */
export function openRailGate(): RailGate {
  return { opened: Promise.resolve(), releaseAfter: () => undefined }
}
