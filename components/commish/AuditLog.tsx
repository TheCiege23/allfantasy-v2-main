'use client'

/**
 * 11a / 11d — the commissioner audit log.
 *
 * ⚠ THE LOG IS A RECORD, NOT A STATUS. No row ever takes a severity colour, per
 * 11d's colour contract. A dismissed integrity flag and a corrected FAAB budget
 * are the same kind of thing here — something a commissioner did, with a
 * timestamp — and tinting the "worse-sounding" ones turns a neutral ledger into
 * an accusation feed.
 *
 * ⚠ THE SUMMARY IS BUILT FROM `actionType` + `entityType`, NOT FROM RAW JSON.
 * `LeagueAuditLog` stores `beforeState`/`afterState` blobs that can hold anything
 * a writer put there, including ids and internal flags. Rendering them would
 * leak implementation detail into a commissioner-facing list and occasionally
 * spill data from an unrelated subsystem, so this component reads only the two
 * enum-ish columns and falls back to a humanised `actionType`.
 */

export type AuditEntry = {
  id: string
  actionType: string
  entityType: string
  createdAt: string
  actorName?: string | null
}

/**
 * Known action types get a written sentence; anything else is humanised from the
 * column. New writers therefore appear in the log immediately, reading a little
 * more mechanically, rather than being invisible until someone adds a case.
 */
const PHRASES: Record<string, string> = {
  broadcast_sent: 'Broadcast sent to @everyone',
  commissioner_broadcast: 'Broadcast sent to @everyone',
  integrity_flag_dismissed: 'Integrity flag dismissed',
  integrity_flag_escalated: 'Integrity flag escalated for review',
  integrity_settings_updated: 'Integrity settings updated',
  trade_reversed: 'Trade reversed',
  trade_approved: 'Trade approved',
  trade_vetoed: 'Trade vetoed',
  faab_adjusted: 'FAAB budget corrected',
  lineup_forced: 'Lineup set on a manager’s behalf',
  waivers_processed: 'Waivers processed',
  settings_updated: 'League settings changed',
  deadline_changed: 'Trade deadline changed',
  rosters_locked: 'Rosters locked',
  rosters_unlocked: 'Rosters unlocked',
}

function humanise(actionType: string): string {
  const key = actionType.trim().toLowerCase()
  if (PHRASES[key]) return PHRASES[key]
  const words = key.replace(/[._-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Commissioner action'
}

/**
 * Time of day for today, weekday for the last week, date beyond that. A log read
 * top-down should get coarser as it goes back, the way a person remembers.
 */
function stamp(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const d = new Date(then)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d
      .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      .replace(/\s?([AP])M/i, (_, p: string) => p.toLowerCase())
  }
  const days = Math.floor((now.getTime() - then) / 86_400_000)
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AuditLog({ entries, emptyNote }: { entries: AuditEntry[]; emptyNote?: string }) {
  if (entries.length === 0) {
    return (
      <p className="af-cm-empty">
        {emptyNote ?? 'No commissioner actions recorded yet. Everything you do here will appear in this list.'}
      </p>
    )
  }

  return (
    <ul className="af-cm-audit" data-testid="audit-log">
      {entries.map((e) => (
        <li key={e.id} className="af-cm-audit-row">
          <span className="af-cm-audit-time af-num">{stamp(e.createdAt)}</span>
          <span className="af-cm-audit-text">
            {humanise(e.actionType)}
            {e.entityType && !humanise(e.actionType).toLowerCase().includes(e.entityType.toLowerCase()) ? (
              <span style={{ color: 'var(--faint)' }}> · {e.entityType.replace(/[._-]+/g, ' ')}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default AuditLog
