'use client'

import '@/components/core-app/af-war-race.css'
import type { RaceRow, WarRace as WarRaceView } from '@/lib/core-app/warRoomRace'
import { pct } from '@/lib/core-app/outlookCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomRaceMessages } from '@/lib/core-app/messages/warRoomRace'

/**
 * The race — War Room phase 8, for the league on screen (rules in lib/core-app/warRoomRace.ts). Free.
 * A team whose place is settled sees nothing: there is no race to show it.
 *
 * ⚠ `id="war-race"` IS AN ANCHOR, like the War Room's other sections.
 */

function useCopy() {
  return useMessages(warRoomRaceMessages)
}
type Copy = ReturnType<typeof useCopy>

const rec = (r: RaceRow) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`

function scheduleText(r: RaceRow, of: number, m: Copy): string {
  if (r.scheduleRank == null || r.gamesLeft === 0) return m.scheduleNone
  if (r.scheduleRank === 1) return m.scheduleHardest(of)
  if (r.scheduleRank === of) return m.scheduleEasiest(of)
  return m.schedule(r.scheduleRank, of)
}

export function WarRace({ view }: { view: WarRaceView }) {
  const m = useCopy()
  if (view.kind === 'none') return null

  // The cut line sits between the last seed in and the first seed out.
  const firstOut = view.rows.findIndex((r) => !r.inField)

  return (
    <section className="af-wra" id="war-race" aria-labelledby="af-wra-heading">
      <h2 id="af-wra-heading" className="af-label af-wra-heading">
        {m.heading}
      </h2>
      <p className="af-wra-note">{m.lead(view.playoffTeams)}</p>

      <ol className="af-wra-list">
        {view.rows.map((r, i) => (
          <li
            key={r.rosterId}
            className="af-wra-row"
            data-you={r.isYou ? 'true' : undefined}
            data-field={r.inField ? 'in' : 'out'}
            data-cut={i === firstOut && i > 0 ? 'true' : undefined}
          >
            <span className="af-wra-seed">{r.seed}</span>
            <div className="af-wra-team">
              <p className="af-wra-name">
                {r.isYou ? m.you : (r.name ?? '—')}
                <span className="af-wra-tag" data-field={r.inField ? 'in' : 'out'}>
                  {r.inField ? m.inField : m.out}
                </span>
              </p>
              <p className="af-wra-meta">{m.record(rec(r), r.pointsFor.toFixed(1))}</p>
              {r.vsYou.length > 0 ? <p className="af-wra-vs">{m.vsYou(r.vsYou)}</p> : null}
            </div>
            <div className="af-wra-odds">
              <span className="af-wra-label">{m.colOdds}</span>
              <span className="af-wra-pct" data-none={r.playoffPct == null ? 'true' : undefined}>
                {r.playoffPct == null ? m.oddsNone : m.odds(pct(r.playoffPct))}
              </span>
            </div>
            <div className="af-wra-sched">
              <span className="af-wra-label">{m.colSchedule}</span>
              <span className="af-wra-rank">{scheduleText(r, view.ranked, m)}</span>
              {r.opponentAvg != null && r.gamesLeft > 0 ? (
                <span className="af-wra-opp">
                  {m.opp(r.opponentAvg.toFixed(1), view.leagueAvg == null ? null : view.leagueAvg.toFixed(1))}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <p className="af-wra-note">{m.basis}</p>
    </section>
  )
}

export default WarRace
