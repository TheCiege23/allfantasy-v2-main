'use client'

/**
 * The "Ask Chimmy" button on the brief card.
 *
 * ⚠ IT OPENS THE PANEL. IT DOES NOT SEND ANYTHING. Opening costs nothing — the
 * thread starts empty and the first request is the user's, which is the standing
 * constraint on this screen and the reason `ChimmyFab` is collapsed by default.
 * A button here that fired a question would spend a token on a click that reads
 * like "show me the chat".
 *
 * ⚠ A CUSTOM EVENT, NOT LIFTED STATE. `ChimmyFab` owns whether the panel is open,
 * and it is mounted as a sibling at the far end of `DashboardV2`. Hoisting that
 * `useState` up to the screen would turn `DashboardV2` — which loads career,
 * portfolio, draft and week data on the server — into a client component and
 * ship all four payloads to the browser. One event on `window` costs nothing and
 * keeps the boundary where it is.
 */

export const CHIMMY_OPEN_EVENT = 'af-d2-chimmy-open'

export function ChimmyAsk({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="af-d2-brief-ask"
      onClick={() => window.dispatchEvent(new CustomEvent(CHIMMY_OPEN_EVENT))}
    >
      {label}
    </button>
  )
}

export default ChimmyAsk
