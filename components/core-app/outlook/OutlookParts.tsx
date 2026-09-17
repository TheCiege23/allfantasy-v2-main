import Link from 'next/link'
import type { Milestones, ScheduleStrength } from '@/lib/core-app/outlookSim'
import type { OddsRange, OutlookAssumptions, OutlookTeam } from '@/lib/core-app/seasonOutlook'
import type { OutlookDriver, OutlookDurability, OutlookMove } from '@/lib/core-app/seasonOutlookFocus'
import { ageLabel, band, ordinal, pct, rangeLabel, signedPts } from '@/lib/core-app/outlookCopy'

/**
 * Season Outlook — the pieces both screens are built from.
 *
 * ⚠ TYPE-ONLY IMPORTS FROM THE SERVER MODULES. `seasonOutlook.ts` and `seasonOutlookFocus.ts` are
 * `server-only`; `import type` is erased at build, which is the only reason these can name their
 * shapes from a client component.
 *
 * Charts here are deliberately small and single-purpose (the dataviz method: a stat tile when the
 * story is one number). Colour never carries meaning alone — every bar has its number in text, and
 * polarity is also a sign character.
 */

// ── Odds ───────────────────────────────────────────────────────────────

export function OddsTile({
  label,
  value,
  range,
  sub,
  tone,
}: {
  label: string
  value: number
  range: OddsRange | null
  sub?: string
  /**
   * `status` colours the number by whether it is good news (playoffs); `invert` does the same for a
   * number where high is bad (missing out). `neutral` is for odds that are naturally small — a 3%
   * title chance is ordinary, and painting it red would read as a warning it is not.
   */
  tone?: 'status' | 'invert' | 'neutral'
}) {
  const b = tone === 'neutral' ? 'none' : tone === 'invert' ? band(100 - value) : band(value)
  return (
    <div className="af-olk-odds" data-band={b}>
      <span className="af-olk-odds-l af-label">{label}</span>
      <span className="af-olk-odds-v af-num">{pct(value)}%</span>
      {range ? (
        <span className="af-olk-range" role="img" aria-label={`Likely range ${rangeLabel(range)}`}>
          <span className="af-olk-range-track" aria-hidden>
            <span
              className="af-olk-range-band"
              style={{ left: `${clamp(range.lo)}%`, width: `${Math.max(1.5, clamp(range.hi) - clamp(range.lo))}%` }}
            />
            <span className="af-olk-range-dot" style={{ left: `${clamp(value)}%` }} />
          </span>
          <span className="af-olk-range-t af-num">range {rangeLabel(range)}</span>
        </span>
      ) : null}
      {sub ? <span className="af-olk-odds-s">{sub}</span> : null}
    </div>
  )
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export function StatusPill({ status }: { status: OutlookTeam['status'] }) {
  if (!status) return null
  return (
    <span className="af-olk-pill" data-status={status}>
      {status === 'clinched' ? '✓ Clinched' : '✕ Eliminated'}
    </span>
  )
}

// ── Drivers ────────────────────────────────────────────────────────────

/**
 * Signed impact, drawn from a centre line. Spread drivers (a single game that can go either way) are
 * drawn both sides of the centre, because their sign is not known yet.
 */
export function DriverList({ drivers, limit }: { drivers: OutlookDriver[]; limit?: number }) {
  const shown = limit ? drivers.slice(0, limit) : drivers
  if (shown.length === 0) {
    return <p className="af-olk-empty">No single factor moves your playoff odds by a point or more.</p>
  }
  const scale = Math.max(10, ...shown.map((d) => Math.abs(d.impact)))
  return (
    <ol className="af-olk-drivers">
      {shown.map((d) => {
        const w = (Math.abs(d.impact) / scale) * 50
        const dir = d.spread ? 'both' : d.impact >= 0 ? 'up' : 'down'
        return (
          <li key={d.key} className="af-olk-driver" data-dir={dir}>
            <div className="af-olk-driver-top">
              <span className="af-olk-driver-l">{d.label}</span>
              <span className="af-olk-driver-v af-num">
                {d.spread ? `±${Math.abs(d.impact).toFixed(0)}` : signedPts(d.impact, 0)} pts
              </span>
            </div>
            <span className="af-olk-diverge" aria-hidden>
              <span className="af-olk-diverge-mid" />
              {dir === 'both' ? (
                <>
                  <span className="af-olk-diverge-bar" data-side="left" style={{ width: `${w}%` }} />
                  <span className="af-olk-diverge-bar" data-side="right" style={{ width: `${w}%` }} />
                </>
              ) : (
                <span className="af-olk-diverge-bar" data-side={dir === 'up' ? 'right' : 'left'} style={{ width: `${w}%` }} />
              )}
            </span>
            <p className="af-olk-driver-d">{d.detail}</p>
          </li>
        )
      })}
    </ol>
  )
}

// ── Moves ──────────────────────────────────────────────────────────────

export function MoveList({ moves, leagueHref }: { moves: OutlookMove[]; leagueHref?: string }) {
  if (moves.length === 0) {
    return (
      <p className="af-olk-empty">
        No lineup or waiver move is worth a point a week or more right now.
        {leagueHref ? (
          <>
            {' '}
            <Link href={leagueHref}>Open the league</Link>
          </>
        ) : null}
      </p>
    )
  }
  return (
    <ul className="af-olk-moves">
      {moves.map((m) => (
        <li key={m.key} className="af-olk-move">
          <div className="af-olk-move-main">
            <span className="af-olk-move-kind af-label">{m.kind === 'lineup' ? `Lineup · week ${m.week}` : 'Waivers · rest of season'}</span>
            <span className="af-olk-move-t">{m.title}</span>
            <span className="af-olk-move-d">{m.detail}</span>
          </div>
          <div className="af-olk-move-fx">
            <span className="af-olk-move-delta af-num" data-dir={m.playoffDelta >= 0.05 ? 'up' : m.playoffDelta <= -0.05 ? 'down' : 'flat'}>
              {signedPts(m.playoffDelta)}
            </span>
            <span className="af-olk-move-unit">playoff pts</span>
            <span className="af-olk-move-sub af-num">
              title {signedPts(m.titleDelta)} · +{m.pointsPerWeek} pts/wk
            </span>
            <Link className="af-olk-move-cta" href={m.href}>
              {m.kind === 'lineup' ? 'Set lineup' : 'Open waivers'}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Milestones ─────────────────────────────────────────────────────────

export function MilestonePanel({ m, playoffTeams }: { m: Milestones; playoffTeams: number }) {
  const losses = (w: number) => m.totalGames - w
  const record = (w: number | null) => (w == null ? '—' : `${w}–${losses(w)}`)
  const rows = m.oddsByWins
    .map((v, w) => ({ w, v }))
    .filter((r) => r.w >= m.currentWins && r.w <= m.maxWins)
  return (
    <div className="af-olk-miles">
      <div className="af-olk-miles-tiles">
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">{record(m.winsForSafe)}</span>
          <span className="af-olk-mini-l">gets you in 9 times in 10</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">{record(m.winsForLikely)}</span>
          <span className="af-olk-mini-l">gets you in more often than not</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">
            {m.cutWinsMedian == null ? '—' : m.cutWinsLow === m.cutWinsHigh ? m.cutWinsMedian : `${m.cutWinsLow}–${m.cutWinsHigh}`}
          </span>
          <span className="af-olk-mini-l">wins for the {ordinal(playoffTeams)} seed, usually</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">
            {m.cutPointsMedian == null ? '—' : Math.round(m.cutPointsMedian).toLocaleString('en-US')}
          </span>
          <span className="af-olk-mini-l">
            points for the {ordinal(playoffTeams)} seed
            {m.cutPointsLow != null && m.cutPointsHigh != null
              ? ` (${Math.round(m.cutPointsLow).toLocaleString('en-US')}–${Math.round(m.cutPointsHigh).toLocaleString('en-US')})`
              : ''}
          </span>
        </div>
      </div>
      <p className="af-olk-note">
        On pace for {m.projectedWins == null ? '—' : record(m.projectedWins)}
        {m.projectedPoints != null ? ` and about ${Math.round(m.projectedPoints).toLocaleString('en-US')} points` : ''} — the
        middle of your simulated finishes.
      </p>
      <figure className="af-olk-wins">
        <figcaption className="af-label">Playoff odds by final record</figcaption>
        <div className="af-olk-wins-bars" aria-hidden>
          {rows.map(({ w, v }) => (
            <span
              key={w}
              className="af-olk-wins-col"
              data-v={v == null ? `${record(w)}: too few runs` : `${record(w)}: ${pct(v)}%`}
              title={v == null ? `${record(w)}: too few runs` : `${record(w)}: ${pct(v)}%`}
            >
              <span className="af-olk-wins-bar" data-known={v != null} style={{ height: `${v == null ? 3 : Math.max(3, v)}%` }} />
              <span className="af-olk-wins-x af-num">{w}</span>
            </span>
          ))}
        </div>
        <table className="af-olk-sr">
          <caption>Playoff odds by final regular-season record</caption>
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Playoff odds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, v }) => (
              <tr key={w}>
                <th scope="row">{record(w)}</th>
                <td>{v == null ? 'too few runs to say' : `${pct(v)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="af-olk-note">Bars show how often a season that ends on that many wins makes the field. Blank bars ended there too rarely to measure.</p>
      </figure>
    </div>
  )
}

// ── Schedule ───────────────────────────────────────────────────────────

export function SchedulePanel({ teams }: { teams: Array<OutlookTeam & { schedule: ScheduleStrength | null }> }) {
  const rows = teams.filter((t) => t.schedule)
  if (rows.length === 0) return <p className="af-olk-empty">No schedule on file for this league.</p>
  const league = rows[0].schedule!.leagueMu
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
  const vs = (v: number | null) => (v == null || league == null ? null : v - league)
  return (
    <div className="af-olk-tablewrap">
      <table className="af-olk-table">
        <caption className="af-olk-caption">
          Opponents&apos; fitted weekly average, already played and still to come, against the league average
          {league != null ? ` of ${league.toFixed(1)}` : ''}. Rank 1 is the hardest.
        </caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="af-olk-n">Played</th>
            <th scope="col" className="af-olk-n">Rank</th>
            <th scope="col" className="af-olk-n">Remaining</th>
            <th scope="col" className="af-olk-n">Rank</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const s = t.schedule!
            const past = vs(s.pastOpponentMu)
            const rest = vs(s.remainingOpponentMu)
            return (
              <tr key={t.rosterId} data-you={t.isYou}>
                <th scope="row">{t.name ?? 'Unnamed team'}</th>
                <td className="af-olk-n af-num">
                  {fmt(s.pastOpponentMu)}
                  {past != null ? <span className="af-olk-vs" data-dir={past > 0 ? 'hard' : 'easy'}> {signedPts(past)}</span> : null}
                  <span className="af-olk-g"> · {s.pastGames} g</span>
                </td>
                <td className="af-olk-n af-num">{s.pastRank ?? '—'}</td>
                <td className="af-olk-n af-num">
                  {fmt(s.remainingOpponentMu)}
                  {rest != null ? <span className="af-olk-vs" data-dir={rest > 0 ? 'hard' : 'easy'}> {signedPts(rest)}</span> : null}
                  <span className="af-olk-g"> · {s.remainingGames} g</span>
                </td>
                <td className="af-olk-n af-num">{s.remainingRank ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Durability ─────────────────────────────────────────────────────────

export function DurabilityPanel({ d }: { d: OutlookDurability }) {
  const share = (n: number) => `${Math.round(n * 100)}%`
  return (
    <div className="af-olk-dur">
      {d.flags.length > 0 ? (
        <ul className="af-olk-flags">
          {d.flags.map((f) => (
            <li key={f}>
              <span aria-hidden>⚠</span> {f}
            </li>
          ))}
        </ul>
      ) : (
        <p className="af-olk-note">Nothing on this roster stands out as fragile.</p>
      )}

      <div className="af-olk-dur-grid">
        <section className="af-olk-card">
          <h3 className="af-label">Age</h3>
          <p className="af-olk-card-v af-num">{d.age.averageAge ?? '—'}</p>
          <p className="af-olk-note">
            average age of {d.age.knownAges} of {d.starters} starters
          </p>
          {d.age.older.length > 0 ? (
            <ul className="af-olk-mini-list">
              {d.age.older.map((p) => (
                <li key={p.name}>
                  {p.name} <span className="af-olk-g">{p.position} · {p.age}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">Depth</h3>
          {d.depth == null ? (
            <p className="af-olk-note">This league stores no lineup slots, so depth cannot be judged.</p>
          ) : d.depth.length === 0 ? (
            <p className="af-olk-note">Every dedicated slot has a healthy backup.</p>
          ) : (
            <ul className="af-olk-mini-list">
              {d.depth.map((f) => (
                <li key={f.position}>
                  <b>{f.position}</b> — {f.healthy} healthy for {f.starters} slot{f.starters === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">Injuries</h3>
          {d.injuries.length === 0 ? (
            <p className="af-olk-note">{d.injuryFeedNote ?? 'No player on this roster is listed as out or at risk.'}</p>
          ) : (
            <>
              <ul className="af-olk-mini-list">
                {d.injuries.map((i) => (
                  <li key={i.name}>
                    {i.name} <span className="af-olk-pill" data-status={i.kind === 'out' ? 'eliminated' : 'risk'}>{i.status}</span>
                    {i.starting ? <span className="af-olk-g"> · in your lineup</span> : null}
                  </li>
                ))}
              </ul>
              {d.injuryFeedNote ? <p className="af-olk-note">{d.injuryFeedNote}</p> : null}
            </>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">Byes still to come</h3>
          {d.byes.length === 0 ? (
            <p className="af-olk-note">No starter has a bye in the remaining regular season, or the NFL schedule is not on file.</p>
          ) : (
            <ul className="af-olk-mini-list">
              {d.byes.map((b) => (
                <li key={b.week}>
                  <b>Wk {b.week}</b> {b.players.join(', ')}
                  {b.pointsLost != null ? <span className="af-olk-g"> · −{b.pointsLost} pts</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">Concentration</h3>
          <ul className="af-olk-mini-list">
            <li>
              Top position:{' '}
              {d.concentration.topPosition ? (
                <b>
                  {d.concentration.topPosition.position} {share(d.concentration.topPosition.share)}
                </b>
              ) : (
                '—'
              )}
            </li>
            <li>
              Top player:{' '}
              {d.concentration.topPlayer ? (
                <b>
                  {d.concentration.topPlayer.name} {share(d.concentration.topPlayer.share)}
                </b>
              ) : (
                '—'
              )}
            </li>
            <li>
              Same NFL team:{' '}
              {d.concentration.stack ? (
                <b>
                  {d.concentration.stack.players.length} from {d.concentration.stack.team}
                </b>
              ) : (
                'no stack of two or more'
              )}
            </li>
          </ul>
          <p className="af-olk-note">Shares of your best lineup&apos;s projected points.</p>
        </section>
      </div>
      {d.basisWeek ? (
        <p className="af-olk-note">
          Points are week {d.basisWeek.week} projections, scored under this league&apos;s rules.
        </p>
      ) : null}
    </div>
  )
}

// ── Assumptions ────────────────────────────────────────────────────────

const SOURCE: Record<string, string> = {
  league: 'from the league’s settings',
  standard: 'standard bracket, not stated by the league',
  default: 'assumed — the league does not say',
}

export function AssumptionsPanel({
  a,
  nowMs,
  extra,
}: {
  a: OutlookAssumptions
  nowMs: number | null
  extra?: { branchIterations?: number; basisWeek?: { season: string; week: number } | null; notes?: string[] }
}) {
  return (
    <div className="af-olk-assume">
      <dl className="af-olk-dl">
        <div>
          <dt>Simulations</dt>
          <dd className="af-num">
            {a.iterations.toLocaleString('en-US')} seasons
            {extra?.branchIterations ? `; ${extra.branchIterations.toLocaleString('en-US')} per what-if` : ''}
          </dd>
        </div>
        <div>
          <dt>Range</dt>
          <dd className="af-num">
            {a.rangeBatches} re-fits × {a.rangeRunsPerBatch.toLocaleString('en-US')} seasons, 10th–90th percentile
          </dd>
        </div>
        <div>
          <dt>Scoring model</dt>
          <dd>
            Each team&apos;s weekly score is drawn from its own average and spread, fitted from{' '}
            {a.weeksFitted
              ? `${a.weeksFitted.min}–${a.weeksFitted.max} completed weeks (median ${a.weeksFitted.median})`
              : 'no completed weeks'}{' '}
            across {a.seasonsFitted.length ? a.seasonsFitted.join(', ') : 'no seasons'}.
          </dd>
        </div>
        <div>
          <dt>Teams modelled</dt>
          <dd className="af-num">
            {a.modelledTeams} of {a.teams}
          </dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd className="af-num">
            {a.remainingGames} games left
            {a.regularSeasonEndWeek != null ? `, regular season ends week ${a.regularSeasonEndWeek}` : ''}
          </dd>
        </div>
        <div>
          <dt>Playoff field</dt>
          <dd>
            {a.playoffTeams.value} teams, {SOURCE[a.playoffTeams.source]}
          </dd>
        </div>
        <div>
          <dt>First-round byes</dt>
          <dd>
            {a.byes.value}, {SOURCE[a.byes.source]}
          </dd>
        </div>
        <div>
          <dt>Seeding</dt>
          <dd>{a.tiebreak}</dd>
        </div>
        {extra?.basisWeek ? (
          <div>
            <dt>Player points</dt>
            <dd>
              Week {extra.basisWeek.week} projections under this league&apos;s scoring, used for every remaining week in
              the what-ifs.
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Last run</dt>
          <dd>
            <time dateTime={a.computedAt}>{nowMs == null ? new Date(a.computedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ageLabel(a.computedAt, nowMs)}</time>
            {a.reused ? ' — reused, because nothing it reads has changed since' : ''}
          </dd>
        </div>
      </dl>
      {a.missing.length + (extra?.notes?.length ?? 0) > 0 ? (
        <>
          <h3 className="af-label">Not modelled, or missing</h3>
          <ul className="af-olk-mini-list">
            {[...a.missing, ...(extra?.notes ?? [])].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
