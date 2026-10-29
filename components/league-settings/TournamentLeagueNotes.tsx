/**
 * Two small notes for a league created by a divisions tournament (a "conference league"):
 *   - SeatlessCoCommissioners — the tournament's co-commissioners who hold no team here. They run the
 *     league (lib/league/tournamentCoCommissioners.ts) but have no roster, so the managers list, which
 *     is built from rosters, never shows them. Data: `tournamentCoCommissioners[]` from
 *     `GET /api/commissioner/leagues/[id]/managers`.
 *   - TournamentPlayoffsNote — shown in place of the league playoff fields: a conference league plays
 *     one regular season through the tournament's championship week and has no league playoffs
 *     (lib/tournament/divisions/conferenceSeasonPlan.ts), so those fields would do nothing.
 */
import { readConferenceSeasonPlan } from '@/lib/tournament/divisions/conferenceSeasonPlan'

export type TournamentCoCommissioner = { userId: string; username: string | null; displayName: string | null; hasTeam: boolean }

/** The tournament co-commissioners list from the managers route, defensively parsed. */
export function readTournamentCoCommissioners(json: unknown): TournamentCoCommissioner[] {
  const raw = json && typeof json === 'object' ? (json as { tournamentCoCommissioners?: unknown }).tournamentCoCommissioners : null
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r) => {
    if (!r || typeof r !== 'object' || typeof (r as { userId?: unknown }).userId !== 'string') return []
    const o = r as Record<string, unknown>
    return [{ userId: o.userId as string, username: typeof o.username === 'string' ? o.username : null, displayName: typeof o.displayName === 'string' ? o.displayName : null, hasTeam: o.hasTeam === true }]
  })
}

export function SeatlessCoCommissioners({ people }: { people: TournamentCoCommissioner[] }) {
  const seatless = people.filter((p) => !p.hasTeam)
  if (!seatless.length) return null
  return (
    <section aria-label="Co-commissioners" className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3" data-testid="tournament-co-commissioners">
      <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">Co-commissioners</p>
      <p className="mt-0.5 text-[12px] text-white/50">Added by the tournament. They help run this league and do not hold a team.</p>
      <ul className="mt-2 space-y-1.5">
        {seatless.map((p) => (
          <li key={p.userId} className="flex items-center justify-between gap-2 text-[13px] text-white/85">
            <span className="min-w-0 truncate">{p.displayName || p.username || 'AllFantasy member'}{p.username && p.displayName && p.displayName !== p.username ? <span className="text-white/45"> @{p.username}</span> : null}</span>
            <span className="shrink-0 rounded-full border border-cyan-500/30 px-2 py-0.5 text-[11px] text-cyan-200">Co-commissioner</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TournamentPlayoffsNote({ settings }: { settings: unknown }) {
  const plan = readConferenceSeasonPlan(settings)
  if (!plan) return null
  const first = plan.bracketWeeks[0]
  return (
    <div role="note" className="rounded-2xl border border-amber-400/25 bg-amber-950/20 p-4" data-testid="tournament-playoffs-note">
      <p className="text-[14px] font-semibold text-amber-100">Playoffs are run by the tournament</p>
      <p className="mt-1 text-[13px] text-white/65">
        This league plays one regular season through week {plan.lastWeek} with no league playoffs. Tournament bracket rounds are played in weeks {first}–{plan.lastWeek}, scored from each manager’s league score that week.
      </p>
    </div>
  )
}

/** True when this league's playoffs belong to its tournament, so league playoff fields are hidden. */
export function tournamentRunsPlayoffs(settings: unknown): boolean {
  return readConferenceSeasonPlan(settings) != null
}
