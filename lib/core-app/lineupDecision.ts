import type { LineupPlayer, LineupSlot } from './myTeam'

/** A kickoff is evidence a game started, never proof of the provider's lineup lock. */
export function hasStarted(player: LineupPlayer | null, now: number): boolean {
  if (!player) return false
  if (player.gameDay && player.gameDay.state !== 'upcoming') return true
  const kickoff = player.kickoff == null ? NaN : new Date(player.kickoff).getTime()
  return Number.isFinite(kickoff) && kickoff <= now
}

export function lineupDecision(slots: LineupSlot[], bench: LineupPlayer[], now: number) {
  const candidates = slots.filter(slot => slot.empty || slot.player?.ruledOut || slot.player?.onBye || slot.benchCheck?.verdict === 'swap')
  // Surface a remaining opportunity ahead of a starter whose game already began.
  const slot = candidates.find(slot => !hasStarted(slot.player, now) && (slot.empty || slot.player?.ruledOut || slot.player?.onBye))
    ?? candidates.find(slot => !hasStarted(slot.player, now))
    ?? candidates[0] ?? null
  const matches = slot?.benchCheck ? bench.filter(player => player.name === slot.benchCheck?.benchName) : []
  // Names alone are not an identity when more than one roster player matches.
  const replacement = matches.length === 1 ? matches[0] : null
  const started = hasStarted(slot?.player ?? null, now)
  const replacementStarted = hasStarted(replacement, now)
  const delta = slot?.player?.afProjectedPoints != null && replacement?.afProjectedPoints != null
    && Number.isFinite(slot.player.afProjectedPoints) && Number.isFinite(replacement.afProjectedPoints)
    ? replacement.afProjectedPoints - slot.player.afProjectedPoints : null
  return { slot, replacement, started, replacementStarted, delta }
}
