import Link from 'next/link'
import type { Milestones, ScheduleStrength } from '@/lib/core-app/outlookSim'
import type { OddsRange, OutlookAssumptions, OutlookTeam } from '@/lib/core-app/seasonOutlook'
import type { OutlookDriver, OutlookDurability, OutlookMove } from '@/lib/core-app/seasonOutlookFocus'
import { ageLabel, band, ordinal, pct, rangeLabel, signedPts } from '@/lib/core-app/outlookCopy'
import { outlookText, ordinalEs } from '@/lib/core-app/outlookSpanish'
import { ageText } from '@/lib/core-app/shellCopy'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { messagesFor } from '@/lib/i18n/messages'
import { outlookPartsMessages } from '@/lib/core-app/messages/outlookParts'

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
 *
 * Every importer is a client component, so each part reads the reader's language itself (2026-10-05);
 * the server-built sentences it is handed go through `outlookText`.
 */

function useEs(): boolean {
  return useOptionalLanguage().language === 'es'
}

/** This file's copy in the reader's language (lib/core-app/messages/outlookParts.ts). */
function useOutlookMessages() {
  return messagesFor(outlookPartsMessages, useOptionalLanguage().language)
}

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
  const msg = useOutlookMessages()
  const b = tone === 'neutral' ? 'none' : tone === 'invert' ? band(100 - value) : band(value)
  return (
    <div className="af-olk-odds" data-band={b}>
      <span className="af-olk-odds-l af-label">{label}</span>
      <span className="af-olk-odds-v af-num">{pct(value)}%</span>
      {range ? (
        <span className="af-olk-range" role="img" aria-label={`${msg.likelyRange} ${rangeLabel(range)}`}>
          <span className="af-olk-range-track" aria-hidden>
            <span
              className="af-olk-range-band"
              style={{ left: `${clamp(range.lo)}%`, width: `${Math.max(1.5, clamp(range.hi) - clamp(range.lo))}%` }}
            />
            <span className="af-olk-range-dot" style={{ left: `${clamp(value)}%` }} />
          </span>
          <span className="af-olk-range-t af-num">{msg.range} {rangeLabel(range)}</span>
        </span>
      ) : null}
      {sub ? <span className="af-olk-odds-s">{sub}</span> : null}
    </div>
  )
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export function StatusPill({ status }: { status: OutlookTeam['status'] }) {
  const msg = useOutlookMessages()
  if (!status) return null
  return (
    <span className="af-olk-pill" data-status={status}>
      {status === 'clinched' ? msg.clinched : msg.eliminated}
    </span>
  )
}

// ── Drivers ────────────────────────────────────────────────────────────

/**
 * Signed impact, drawn from a centre line. Spread drivers (a single game that can go either way) are
 * drawn both sides of the centre, because their sign is not known yet.
 */
export function DriverList({ drivers, limit }: { drivers: OutlookDriver[]; limit?: number }) {
  const es = useEs()
  const msg = useOutlookMessages()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  const shown = limit ? drivers.slice(0, limit) : drivers
  if (shown.length === 0) {
    return (
      <p className="af-olk-empty">
        {msg.noDrivers}
      </p>
    )
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
              <span className="af-olk-driver-l">{say(d.label)}</span>
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
            <p className="af-olk-driver-d">{say(d.detail)}</p>
          </li>
        )
      })}
    </ol>
  )
}

// ── Moves ──────────────────────────────────────────────────────────────

export function MoveList({ moves, leagueHref }: { moves: OutlookMove[]; leagueHref?: string }) {
  const es = useEs()
  const msg = useOutlookMessages()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  if (moves.length === 0) {
    return (
      <p className="af-olk-empty">
        {msg.noMoves}
        {leagueHref ? (
          <>
            {' '}
            <Link href={leagueHref}>{msg.openLeague}</Link>
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
            <span className="af-olk-move-kind af-label">
              {m.kind === 'lineup' ? msg.lineupWeek(m.week) : msg.waiversRest}
            </span>
            <span className="af-olk-move-t">{say(m.title)}</span>
            <span className="af-olk-move-d">{say(m.detail)}</span>
          </div>
          <div className="af-olk-move-fx">
            <span className="af-olk-move-delta af-num" data-dir={m.playoffDelta >= 0.05 ? 'up' : m.playoffDelta <= -0.05 ? 'down' : 'flat'}>
              {signedPts(m.playoffDelta)}
            </span>
            <span className="af-olk-move-unit">{msg.playoffPts}</span>
            <span className="af-olk-move-sub af-num">
              {msg.title} {signedPts(m.titleDelta)} · +{m.pointsPerWeek} {msg.ptsPerWeek}
            </span>
            <Link className="af-olk-move-cta" href={m.href}>
              {m.kind === 'lineup' ? msg.setLineup : msg.openWaivers}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Milestones ─────────────────────────────────────────────────────────

export function MilestonePanel({ m, playoffTeams }: { m: Milestones; playoffTeams: number }) {
  const es = useEs()
  const msg = useOutlookMessages()
  const seed = es ? ordinalEs(playoffTeams) : ordinal(playoffTeams)
  const num = (n: number) => Math.round(n).toLocaleString(es ? 'es-ES' : 'en-US')
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
          <span className="af-olk-mini-l">{msg.safeIn}</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">{record(m.winsForLikely)}</span>
          <span className="af-olk-mini-l">{msg.likelyIn}</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">
            {m.cutWinsMedian == null ? '—' : m.cutWinsLow === m.cutWinsHigh ? m.cutWinsMedian : `${m.cutWinsLow}–${m.cutWinsHigh}`}
          </span>
          <span className="af-olk-mini-l">{msg.winsForSeed(seed)}</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">
            {m.cutPointsMedian == null ? '—' : num(m.cutPointsMedian)}
          </span>
          <span className="af-olk-mini-l">
            {msg.pointsForSeed(seed)}
            {m.cutPointsLow != null && m.cutPointsHigh != null ? ` (${num(m.cutPointsLow)}–${num(m.cutPointsHigh)})` : ''}
          </span>
        </div>
      </div>
      <p className="af-olk-note">
        {msg.onPace(
          m.projectedWins == null ? '—' : record(m.projectedWins),
          m.projectedPoints != null ? num(m.projectedPoints) : null,
        )}
      </p>
      <figure className="af-olk-wins">
        <figcaption className="af-label">
          {msg.oddsByRecord} <TopicTip topic="winsMilestones" />
        </figcaption>
        <div className="af-olk-wins-bars" aria-hidden>
          {rows.map(({ w, v }) => (
            <span
              key={w}
              className="af-olk-wins-col"
              data-v={v == null ? `${record(w)}: ${msg.tooFewRuns}` : `${record(w)}: ${pct(v)}%`}
            >
              <span className="af-olk-wins-bar" data-known={v != null} style={{ height: `${v == null ? 3 : Math.max(3, v)}%` }} />
              <span className="af-olk-wins-x af-num">{w}</span>
            </span>
          ))}
        </div>
        <table className="af-olk-sr">
          <caption>
            {msg.oddsByRecordCaption}
          </caption>
          <thead>
            <tr>
              <th scope="col">{msg.record}</th>
              <th scope="col">{msg.playoffOdds}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, v }) => (
              <tr key={w}>
                <th scope="row">{record(w)}</th>
                <td>{v == null ? msg.tooFewRunsToSay : `${pct(v)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="af-olk-note">
          {msg.barsNote}
        </p>
      </figure>
    </div>
  )
}

// ── Schedule ───────────────────────────────────────────────────────────

export function SchedulePanel({ teams }: { teams: Array<OutlookTeam & { schedule: ScheduleStrength | null }> }) {
  const msg = useOutlookMessages()
  const rows = teams.filter((t) => t.schedule)
  if (rows.length === 0) {
    return <p className="af-olk-empty">{msg.noSchedule}</p>
  }
  const league = rows[0].schedule!.leagueMu
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
  const vs = (v: number | null) => (v == null || league == null ? null : v - league)
  return (
    <div className="af-olk-tablewrap">
      <table className="af-olk-table">
        <caption className="af-olk-caption">
          {msg.scheduleCaption(league != null ? league.toFixed(1) : null)}
        </caption>
        <thead>
          <tr>
            <th scope="col">{msg.team}</th>
            <th scope="col" className="af-olk-n">{msg.played}</th>
            <th scope="col" className="af-olk-n">{msg.rank}</th>
            <th scope="col" className="af-olk-n">{msg.remaining}</th>
            <th scope="col" className="af-olk-n">{msg.rank}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const s = t.schedule!
            const past = vs(s.pastOpponentMu)
            const rest = vs(s.remainingOpponentMu)
            return (
              <tr key={t.rosterId} data-you={t.isYou}>
                <th scope="row">{t.name ?? msg.unnamedTeam}</th>
                <td className="af-olk-n af-num">
                  {fmt(s.pastOpponentMu)}
                  {past != null ? <span className="af-olk-vs" data-dir={past > 0 ? 'hard' : 'easy'}> {signedPts(past)}</span> : null}
                  <span className="af-olk-g"> · {s.pastGames} {msg.gamesAbbr}</span>
                </td>
                <td className="af-olk-n af-num">{s.pastRank ?? '—'}</td>
                <td className="af-olk-n af-num">
                  {fmt(s.remainingOpponentMu)}
                  {rest != null ? <span className="af-olk-vs" data-dir={rest > 0 ? 'hard' : 'easy'}> {signedPts(rest)}</span> : null}
                  <span className="af-olk-g"> · {s.remainingGames} {msg.gamesAbbr}</span>
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
  const es = useEs()
  const msg = useOutlookMessages()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  const share = (n: number) => `${Math.round(n * 100)}%`
  return (
    <div className="af-olk-dur">
      {d.flags.length > 0 ? (
        <ul className="af-olk-flags">
          {d.flags.map((f) => (
            <li key={f}>
              <span aria-hidden>⚠</span> {say(f)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="af-olk-note">{msg.nothingFragile}</p>
      )}

      <div className="af-olk-dur-grid">
        <section className="af-olk-card">
          <h3 className="af-label">{msg.age}</h3>
          <p className="af-olk-card-v af-num">{d.age.averageAge ?? '—'}</p>
          <p className="af-olk-note">
            {msg.averageAge(d.age.knownAges, d.starters)}
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
          <h3 className="af-label">{msg.depth}</h3>
          {d.depth == null ? (
            <p className="af-olk-note">
              {msg.noLineupSlots}
            </p>
          ) : d.depth.length === 0 ? (
            <p className="af-olk-note">{msg.everySlotBacked}</p>
          ) : (
            <ul className="af-olk-mini-list">
              {d.depth.map((f) => (
                <li key={f.position}>
                  <b>{f.position}</b> —{' '}
                  {msg.depthLine(f.healthy, f.starters)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{msg.injuries}</h3>
          {d.injuries.length === 0 ? (
            <p className="af-olk-note">
              {d.injuryFeedNote
                ? say(d.injuryFeedNote)
                : msg.noInjuries}
            </p>
          ) : (
            <>
              <ul className="af-olk-mini-list">
                {d.injuries.map((i) => (
                  <li key={i.name}>
                    {i.name} <span className="af-olk-pill" data-status={i.kind === 'out' ? 'eliminated' : 'risk'}>{i.status}</span>
                    {i.starting ? <span className="af-olk-g"> · {msg.inYourLineup}</span> : null}
                  </li>
                ))}
              </ul>
              {d.injuryFeedNote ? <p className="af-olk-note">{say(d.injuryFeedNote)}</p> : null}
            </>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{msg.byesToCome}</h3>
          {d.byes.length === 0 ? (
            <p className="af-olk-note">
              {msg.noByes}
            </p>
          ) : (
            <ul className="af-olk-mini-list">
              {d.byes.map((b) => (
                <li key={b.week}>
                  <b>{msg.weekAbbr} {b.week}</b> {b.players.join(', ')}
                  {b.pointsLost != null ? <span className="af-olk-g"> · −{b.pointsLost} pts</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{msg.concentration}</h3>
          <ul className="af-olk-mini-list">
            <li>
              {msg.topPosition}{' '}
              {d.concentration.topPosition ? (
                <b>
                  {d.concentration.topPosition.position} {share(d.concentration.topPosition.share)}
                </b>
              ) : (
                '—'
              )}
            </li>
            <li>
              {msg.topPlayer}{' '}
              {d.concentration.topPlayer ? (
                <b>
                  {d.concentration.topPlayer.name} {share(d.concentration.topPlayer.share)}
                </b>
              ) : (
                '—'
              )}
            </li>
            <li>
              {msg.sameNflTeam}{' '}
              {d.concentration.stack ? (
                <b>
                  {d.concentration.stack.players.length} {msg.from} {d.concentration.stack.team}
                </b>
              ) : (
                msg.noStack
              )}
            </li>
          </ul>
          <p className="af-olk-note">
            {msg.sharesNote}
          </p>
        </section>
      </div>
      {d.basisWeek ? (
        <p className="af-olk-note">
          {msg.basisWeek(d.basisWeek.week)}
        </p>
      ) : null}
    </div>
  )
}

// ── Assumptions ────────────────────────────────────────────────────────

const SOURCE: Record<string, 'sourceLeague' | 'sourceStandard' | 'sourceDefault'> = {
  league: 'sourceLeague',
  standard: 'sourceStandard',
  default: 'sourceDefault',
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
  const es = useEs()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  const n = (v: number) => v.toLocaleString(es ? 'es-ES' : 'en-US')
  const msg = useOutlookMessages()
  const source = (key: string) => (SOURCE[key] ? msg[SOURCE[key]] : undefined)
  return (
    <div className="af-olk-assume">
      <dl className="af-olk-dl">
        <div>
          <dt>{msg.simulations}</dt>
          <dd className="af-num">
            {n(a.iterations)} {msg.seasons}
            {extra?.branchIterations ? `; ${n(extra.branchIterations)} ${msg.perWhatIf}` : ''}
          </dd>
        </div>
        <div>
          <dt>{msg.rangeTitle}</dt>
          <dd className="af-num">
            {msg.rangeDetail(a.rangeBatches, n(a.rangeRunsPerBatch))}
          </dd>
        </div>
        <div>
          <dt>{msg.scoringModel}</dt>
          <dd>
            {msg.scoringDetail(a.weeksFitted, a.seasonsFitted)}
          </dd>
        </div>
        <div>
          <dt>{msg.teamsModelled}</dt>
          <dd className="af-num">
            {a.modelledTeams} {msg.of} {a.teams}
          </dd>
        </div>
        <div>
          <dt>{msg.schedule}</dt>
          <dd className="af-num">
            {msg.gamesLeft(a.remainingGames)}
            {a.regularSeasonEndWeek != null ? msg.seasonEnds(a.regularSeasonEndWeek) : ''}
          </dd>
        </div>
        <div>
          <dt>{msg.playoffField}</dt>
          <dd>
            {a.playoffTeams.value} {msg.teams}, {source(a.playoffTeams.source)}
          </dd>
        </div>
        <div>
          <dt>{msg.firstRoundByes}</dt>
          <dd>
            {a.byes.value}, {source(a.byes.source)}
          </dd>
        </div>
        <div>
          <dt>{msg.seeding}</dt>
          <dd>{say(a.tiebreak)}</dd>
        </div>
        {extra?.basisWeek ? (
          <div>
            <dt>{msg.playerPoints}</dt>
            <dd>
              {msg.playerPointsDetail(extra.basisWeek.week)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{msg.lastRun}</dt>
          <dd>
            <time dateTime={a.computedAt}>
              {nowMs == null
                ? new Date(a.computedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
                : es
                  ? ageLabel(a.computedAt, nowMs) === 'unknown'
                    ? 'desconocida'
                    : ageText(ageLabel(a.computedAt, nowMs), 'es')
                  : ageLabel(a.computedAt, nowMs)}
            </time>
            {a.reused ? msg.reused : ''}
          </dd>
        </div>
      </dl>
      {a.missing.length + (extra?.notes?.length ?? 0) > 0 ? (
        <>
          <h3 className="af-label">{msg.notModelled}</h3>
          <ul className="af-olk-mini-list">
            {[...a.missing, ...(extra?.notes ?? [])].map((m) => (
              <li key={m}>{say(m)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
