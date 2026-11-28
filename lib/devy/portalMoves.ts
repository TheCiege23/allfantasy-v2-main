/**
 * Transfer-portal moves for college players, as a manager reads them. Pure and client-safe.
 *
 * Source: CFBD's portal list, written onto `DevyPlayer` by `ingestCFBDTransferPortal`
 * (lib/devy-classification.ts): `transferStatus`, `transferFromSchool`, `transferToSchool`,
 * `transferEligibility`. ⚠ `transferStatus` is set once and never cleared, and the ingest reads the
 * portal for the current calendar year, so a flag seen in November describes the move before THIS
 * season, not a new one. Every line here therefore names the portal year rather than saying "in the
 * portal" as if it were happening now.
 */

export type CollegeTransfer = {
  transferStatus?: boolean | null
  transferFromSchool?: string | null
  transferToSchool?: string | null
  transferEligibility?: string | null
}

/**
 * The portal year a stored flag refers to: the season the move was for. CFBD keys its portal list by
 * that season, and the ingest asks for the current calendar year.
 */
export function portalYearFor(now: Date = new Date()): number {
  return now.getUTCFullYear()
}

function eligibilityNote(eligibility: string | null | undefined): string | null {
  const e = String(eligibility ?? '').trim().toLowerCase()
  if (!e) return null
  if (e === 'immediate') return 'eligible right away'
  if (e.includes('withdrawn')) return 'withdrew from the portal'
  return `eligibility: ${String(eligibility).trim()}`
}

/**
 * One line for a player card, or null when the player has no portal move on record.
 *   "Transferred from Auburn to Texas (2026 portal), eligible right away"
 *   "Entered the 2026 portal from Louisville, no new school yet"
 */
export function describeCollegeTransfer(t: CollegeTransfer, portalYear: number): string | null {
  if (!t.transferStatus) return null
  const from = t.transferFromSchool?.trim() || null
  const to = t.transferToSchool?.trim() || null
  const note = eligibilityNote(t.transferEligibility)
  let line: string
  if (from && to && from !== to) line = `Transferred from ${from} to ${to} (${portalYear} portal)`
  else if (from) line = `Entered the ${portalYear} portal from ${from}, no new school yet`
  else if (to) line = `Transferred to ${to} (${portalYear} portal)`
  else return null
  return note && !(note.startsWith('withdrew') && !to) ? `${line}, ${note}` : line
}

export type PortalMove = {
  devyPlayerId: string
  name: string
  position: string | null
  kind: 'entered' | 'committed'
  from: string
  to: string | null
  eligibility: string | null
}

/**
 * Whether a portal entry is news for a stored player: he entered the portal (no move on record, or a
 * move from a different school than the one stored, i.e. a second transfer), or a destination appeared
 * or changed. Re-reading the same list every day yields nothing, so switching alerts on cannot replay
 * last winter's moves.
 */
export function portalMoveFor(
  stored: CollegeTransfer & { id: string; name: string; position?: string | null },
  entry: { origin: string | null; destination?: string | null; eligibility?: string | null },
): PortalMove | null {
  const origin = entry.origin?.trim() || null
  if (!origin) return null
  const destination = entry.destination?.trim() || null
  const base = { devyPlayerId: stored.id, name: stored.name, position: stored.position ?? null, from: origin, eligibility: entry.eligibility ?? null }
  const sameMove = Boolean(stored.transferStatus) && stored.transferFromSchool?.trim() === origin
  if (!sameMove) return { ...base, kind: destination ? 'committed' : 'entered', to: destination }
  if (destination && destination !== (stored.transferToSchool?.trim() || null)) return { ...base, kind: 'committed', to: destination }
  return null
}

/** The alert a manager holding the player gets. Chimmy is the voice; never "AI". */
export function portalMoveAlert(move: PortalMove): { title: string; body: string } {
  const who = move.position ? `${move.name} (${move.position})` : move.name
  const note = eligibilityNote(move.eligibility)
  if (move.kind === 'committed' && move.to) {
    return {
      title: `Portal move: ${move.name} is headed to ${move.to}`,
      body: `Chimmy: ${who}, on your devy roster, is transferring from ${move.from} to ${move.to}${note ? `, ${note}` : ''}.`,
    }
  }
  return {
    title: `Portal: ${move.name} entered the transfer portal`,
    body: `Chimmy: ${who}, on your devy roster, has entered the transfer portal from ${move.from}. No new school yet.`,
  }
}
