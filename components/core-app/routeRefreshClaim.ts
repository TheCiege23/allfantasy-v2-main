/**
 * Which poller owns `router.refresh()` for the screen on display.
 *
 * `/core` has two timers that each re-run the whole route: the shell's own
 * (AfCoreShell, every screen) and the matchup board's (MatchupPulseRefresh). On
 * `/core/matchup` both were mounted, so every period paid for TWO full renders of
 * the same route — each one a read across every claimed team in the portfolio.
 *
 * The board's timer is the better-informed of the two — it knows whether any
 * ranked row can still move (`inPlay`) and guards against a refresh still in
 * flight — so while it is mounted it claims the route and the shell stands down.
 *
 * A counter rather than a flag, so a remount that mounts the new board before
 * unmounting the old one cannot release a claim the new one still holds.
 */
let claims = 0

export function claimRouteRefresh(): () => void {
  claims += 1
  let released = false
  return () => {
    if (released) return
    released = true
    claims -= 1
  }
}

export function routeRefreshClaimed(): boolean {
  return claims > 0
}
