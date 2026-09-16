import Link from 'next/link'
import { getLevelIcon } from '@/lib/rank/levels'
import {
  GRADE_SCALE,
  PLAYER_POSITIONS,
  type CompareData,
  type CompareKind,
  type CompareManager,
  type CompareResult,
  type LeagueCompareData,
  type LeagueCompareSide,
  type PlayerPickData,
  type TeamCompareData,
  type TeamCompareSide,
} from '@/lib/core-app/rankings'
import '@/components/core-app/af-rankings-screen.css'

/**
 * Compare — handoff 14c, widened from managers to four kinds.
 *
 *   managers  your career against another ranked manager's, normalised
 *   leagues   two of your own league-seasons — the setting and your result
 *   teams     two teams in one league, from that league's standings
 *   players   hands two players to the Player Finder's own side-by-side
 *
 * ⚠ EVERY PICKER IS A PLAIN GET FORM, so a comparison is a URL and the back
 * button behaves. Nothing is compared from numbers the browser sent: the server
 * re-reads both sides from the database on every request.
 *
 * ⚠ HEAD-TO-HEAD RENDERS AS UNANSWERED, NOT AS ZERO. Imported history stores
 * each manager's own season, not who played whom each week.
 */

const KINDS: Array<{ key: CompareKind; label: string }> = [
  { key: 'managers', label: 'Managers' },
  { key: 'leagues', label: 'Leagues' },
  { key: 'teams', label: 'Teams' },
  { key: 'players', label: 'Players' },
]

function qs(pairs: Array<[string, string | null | undefined]>): string {
  const p = new URLSearchParams()
  for (const [k, v] of pairs) if (v != null && v !== '') p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function RankingsCompare({
  kind,
  result,
  query,
  leagues,
  teams,
  players,
  filterPairs = [],
}: {
  kind: CompareKind
  result: CompareResult | null
  query: string
  leagues: LeagueCompareData | null
  teams: TeamCompareData | null
  players: PlayerPickData | null
  filterPairs?: Array<[string, string]>
}) {
  return (
    <div className="af-rk">
      <header className="af-rk-head">
        <div>
          <h1 className="af-rk-title">Compare</h1>
          <p className="af-rk-sub">Side by side, on the same scale the rankings use.</p>
        </div>
        <div className="af-rk-headact">
          <Link className="af-rk-btn" href={`/core/rankings${qs(filterPairs)}`}>
            ← Rankings
          </Link>
        </div>
      </header>

      <nav className="af-rk-tabs" aria-label="What to compare">
        {KINDS.map((k) => (
          <Link
            key={k.key}
            href={`/core/rankings${qs([['view', 'compare'], ['kind', k.key === 'managers' ? null : k.key], ...(k.key === 'managers' ? filterPairs : [])])}`}
            className="af-rk-tab"
            aria-current={k.key === kind ? 'page' : undefined}
          >
            {k.label}
          </Link>
        ))}
      </nav>

      {kind === 'managers' ? (
        <ManagersCompare result={result} query={query} filterPairs={filterPairs} />
      ) : kind === 'leagues' && leagues ? (
        <LeaguesCompare data={leagues} />
      ) : kind === 'teams' && teams ? (
        <TeamsCompare data={teams} />
      ) : kind === 'players' && players ? (
        <PlayersCompare data={players} />
      ) : (
        <section className="af-rk-card">
          <p className="af-rk-a">This comparison could not be loaded just now.</p>
        </section>
      )}
    </div>
  )
}

/* ─────────────────────────────── managers ───────────────────────────────── */

function ManagersCompare({
  result,
  query,
  filterPairs,
}: {
  result: CompareResult | null
  query: string
  filterPairs: Array<[string, string]>
}) {
  return (
    <>
      <form className="af-rk-search" action="/core/rankings" method="get" aria-label="Compare with a manager">
        <input type="hidden" name="view" value="compare" />
        {filterPairs.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="af-rk-input">
          <span aria-hidden="true">@</span>
          <input type="text" name="user" defaultValue={query} placeholder="username" aria-label="Manager username to compare against" autoComplete="off" />
        </label>
        <button type="submit" className="af-rk-btn af-rk-btn--primary">
          Compare
        </button>
      </form>

      {result == null ? (
        <section className="af-rk-card">
          <p className="af-rk-a">
            Enter a manager&apos;s username, or use a name on the community board. Only managers whose careers have been
            ranked can be compared — the comparison reads the same ledger the boards do.
          </p>
        </section>
      ) : !result.ok ? (
        <section className="af-rk-card">
          <h2 className="af-rk-q">No comparison</h2>
          <p className="af-rk-a">{result.message}</p>
          {result.reason === 'not-found' ? (
            <p className="af-rk-note">
              Handles are matched exactly against display names and usernames — a near miss is reported as a miss rather
              than compared against somebody else.
            </p>
          ) : null}
        </section>
      ) : (
        <ManagersBody data={result.data} />
      )}
    </>
  )
}

function ManagerCard({ m, side }: { m: CompareManager; side: 'you' | 'them' }) {
  return (
    <section className={`af-rk-card${side === 'you' ? ' af-rk-card--you' : ''}`}>
      <div className="af-rk-vsman">
        {m.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-rk-crest" src={m.avatarUrl} alt="" width={54} height={54} />
        ) : (
          <span className="af-rk-crest" aria-hidden="true">
            {getLevelIcon(m.tierGroup)}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <p className="af-rk-vsname">
            @{m.handle}
            {side === 'you' ? <span className="af-rk-sr"> (you)</span> : null}
          </p>
          <p className="af-rk-vsmeta">
            Lvl {m.level} {m.levelName} · {m.leagueSeasons.toLocaleString()} league-seasons · {m.confidence} confidence
          </p>
        </div>
        <div className="af-rk-vsgrade">
          <b aria-label={`Grade ${m.grade}`}>{m.grade}</b>
          <span>{m.gradeScore == null ? '—' : m.gradeScore.toFixed(1)}</span>
        </div>
      </div>
    </section>
  )
}

function ManagersBody({ data }: { data: CompareData }) {
  const pct = (v: number | null) => (v == null ? 0 : Math.max(0, Math.min(100, Math.round(v * 100))))
  return (
    <>
      <div className="af-rk-vs">
        <ManagerCard m={data.you} side="you" />
        <div className="af-rk-vsmid" aria-hidden="true">
          <b>VS</b>
          <span className="af-rk-cellsub">{data.filtersLabel}</span>
        </div>
        <ManagerCard m={data.them} side="them" />
      </div>

      <p className="af-rk-note af-rk-mono">
        Grade scale {GRADE_SCALE.map((g) => `${g.grade} ${g.min === 0 ? 'below' : g.min}`).join(' · ')} — from the AF manager
        score
      </p>

      <section className="af-rk-card" style={{ padding: 0 }}>
        <div className="af-rk-tablewrap" role="region" aria-label="Career comparison" tabIndex={0}>
          <table className="af-rk-table">
            <caption className="af-rk-sr">
              @{data.you.handle} against @{data.them.handle}, {data.filtersLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'right' }}>
                  @{data.you.handle}
                </th>
                <th scope="col" style={{ textAlign: 'center' }}>
                  Measure
                </th>
                <th scope="col">@{data.them.handle}</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.label} className={m.signature ? 'sig' : undefined}>
                  <td className={`n${m.leader === 'you' ? ' lead' : ''}`}>
                    {m.you}
                    {m.leader === 'you' ? <span className="af-rk-sr"> (leads)</span> : null}
                  </td>
                  <th scope="row" style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600 }}>
                    {m.label}
                    {m.note || m.unavailable ? <span className="af-rk-cellsub">{m.unavailable ?? m.note}</span> : null}
                  </th>
                  <td className={`n${m.leader === 'them' ? ' lead' : ''}`} style={{ textAlign: 'left' }}>
                    {m.them}
                    {m.leader === 'them' ? <span className="af-rk-sr"> (leads)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="af-rk-cmpfoot">
        <div className="af-rk-col">
          <section className="af-rk-card">
            <p className="af-rk-eyebrow">
              Season by season
              <span className="af-rk-spacer" />
              <span>years you both played</span>
            </p>
            {data.sharedSeasons.length === 0 ? (
              <p className="af-rk-empty">You have no season with results in common{data.filtersLabel !== 'All leagues' ? ` in ${data.filtersLabel}` : ''}.</p>
            ) : (
              <div className="af-rk-tablewrap" role="region" aria-label="Season by season" tabIndex={0}>
                <table className="af-rk-table">
                  <thead>
                    <tr>
                      <th scope="col">Season</th>
                      <th scope="col">@{data.you.handle}</th>
                      <th scope="col">@{data.them.handle}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sharedSeasons.map((s) => (
                      <tr key={s.season}>
                        <th scope="row" className="af-rk-mono">
                          {s.season}
                        </th>
                        <td className={s.youScore != null && s.themScore != null && s.youScore > s.themScore ? 'af-rk-tone-good' : undefined}>
                          {s.you} · {s.youScore == null ? '—' : s.youScore.toFixed(1)}
                        </td>
                        <td className={s.youScore != null && s.themScore != null && s.themScore > s.youScore ? 'af-rk-tone-good' : undefined}>
                          {s.them} · {s.themScore == null ? '—' : s.themScore.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="af-rk-note">Each year is scored on its own leagues. A year one of you sat out is left out, never counted as a loss.</p>
          </section>

          <section className="af-rk-card">
            <p className="af-rk-eyebrow">
              Leagues you shared
              <span className="af-rk-spacer" />
              <span>{data.sharedLeagues.length}</span>
            </p>
            {data.sharedLeagues.length === 0 ? (
              <p className="af-rk-empty">No league-season appears in both careers.</p>
            ) : (
              <div className="af-rk-tablewrap" role="region" aria-label="Shared leagues" tabIndex={0}>
                <table className="af-rk-table">
                  <thead>
                    <tr>
                      <th scope="col">League</th>
                      <th scope="col">@{data.you.handle}</th>
                      <th scope="col">@{data.them.handle}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sharedLeagues.map((l, i) => (
                      <tr key={`${l.season}-${l.league}-${i}`}>
                        <th scope="row">
                          {l.league}
                          <span className="af-rk-cellsub">{l.season}</span>
                        </th>
                        <td>{l.you}</td>
                        <td>{l.them}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="af-rk-col">
          {data.verdict ? (
            <section className="af-rk-card">
              <p className="af-rk-eyebrow">The verdict</p>
              <p className="af-rk-verdict-h">{data.verdict.headline}</p>
              <p className="af-rk-a">{data.verdict.body}</p>
            </section>
          ) : null}
          <section className="af-rk-card">
            <p className="af-rk-eyebrow">Head to head</p>
            <p className="af-rk-empty">{data.headToHeadNote}</p>
          </section>
          <section className="af-rk-card">
            <p className="af-rk-eyebrow">Title conversion</p>
            {(['you', 'them'] as const).map((side) => (
              <div className="af-rk-ratebar" key={side}>
                <div className="af-rk-ratebar-l">
                  <span>@{data[side].handle}</span>
                  <b>{data.titleRate[side] == null ? '—' : `${pct(data.titleRate[side])}%`}</b>
                </div>
                <div className="af-rk-split" aria-hidden="true">
                  <i className={side} style={{ width: `${pct(data.titleRate[side])}%` }} />
                </div>
              </div>
            ))}
            <p className="af-rk-note">Titles divided by playoff berths. A manager who never reached the playoffs has no rate rather than zero.</p>
          </section>
        </div>
      </div>
    </>
  )
}

/* ──────────────────────────────── leagues ───────────────────────────────── */

function LeagueSelect({ name, label, value, options }: { name: string; label: string; value: string | null; options: LeagueCompareData['options'] }) {
  const seasons = [...new Set(options.map((o) => o.season))]
  return (
    <label className="af-rk-field af-rk-field--wide">
      <span>{label}</span>
      <select name={name} defaultValue={value ?? ''}>
        <option value="">Choose a league-season</option>
        {seasons.map((season) => (
          <optgroup key={season} label={String(season)}>
            {options
              .filter((o) => o.season === season)
              .map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function LeaguesCompare({ data }: { data: LeagueCompareData }) {
  if (!data.signedIn) {
    return (
      <section className="af-rk-card">
        <p className="af-rk-a">Sign in to compare your own leagues.</p>
      </section>
    )
  }
  const sides = [data.a, data.b].filter((s): s is LeagueCompareSide => s != null)
  return (
    <>
      <form className="af-rk-filters" action="/core/rankings" method="get" aria-label="Choose two league-seasons">
        <input type="hidden" name="view" value="compare" />
        <input type="hidden" name="kind" value="leagues" />
        <LeagueSelect name="a" label="First league-season" value={data.a?.key ?? null} options={data.options} />
        <LeagueSelect name="b" label="Second league-season" value={data.b?.key ?? null} options={data.options} />
        <div className="af-rk-filter-actions">
          <button type="submit" className="af-rk-btn af-rk-btn--primary">
            Compare
          </button>
        </div>
      </form>
      {data.options.length === 0 ? (
        <p className="af-rk-empty">You have no imported league-seasons yet.</p>
      ) : sides.length < 2 ? (
        <p className="af-rk-empty">Choose two league-seasons to see them side by side.</p>
      ) : (
        <section className="af-rk-card" style={{ padding: 0 }}>
          <div className="af-rk-tablewrap" role="region" aria-label="League comparison" tabIndex={0}>
            <table className="af-rk-table">
              <caption className="af-rk-sr">
                {sides[0].title} against {sides[1].title}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">{sides[0].title}</th>
                  <th scope="col">{sides[1].title}</th>
                </tr>
              </thead>
              <tbody>
                {sides[0].facts.map((f, i) => (
                  <tr key={f.label}>
                    <th scope="row">{f.label}</th>
                    <td>{f.value}</td>
                    <td>{sides[1].facts[i]?.value ?? '—'}</td>
                  </tr>
                ))}
                {sides[0].score.components.map((c, i) => {
                  const other = sides[1].score.components[i]
                  const lead =
                    c.credit != null && other?.credit != null && c.credit !== other.credit ? (c.credit > other.credit ? 0 : 1) : null
                  return (
                    <tr key={c.key} className={c.key === 'titles' ? 'sig' : undefined}>
                      <th scope="row">
                        {c.label}
                        <span className="af-rk-cellsub">your result, normalised</span>
                      </th>
                      <td className={lead === 0 ? 'af-rk-tone-good' : undefined}>{c.value}</td>
                      <td className={lead === 1 ? 'af-rk-tone-good' : undefined}>{other?.value ?? '—'}</td>
                    </tr>
                  )
                })}
                <tr className="sig">
                  <th scope="row">Score for this league-season</th>
                  <td className="af-rk-mono">{sides[0].score.score == null ? '—' : sides[0].score.score.toFixed(1)}</td>
                  <td className="af-rk-mono">{sides[1].score.score == null ? '—' : sides[1].score.score.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="af-rk-note" style={{ padding: '0 16px 16px' }}>
            A single league-season is a small sample, so each score is pulled toward average. Title odds are the 1-in-N chance
            the league offered at the start.
          </p>
        </section>
      )}
    </>
  )
}

/* ───────────────────────────────── teams ────────────────────────────────── */

function TeamsCompare({ data }: { data: TeamCompareData }) {
  const sides = [data.a, data.b].filter((s): s is TeamCompareSide => s != null)
  return (
    <>
      <form className="af-rk-filters" action="/core/rankings" method="get" aria-label="Choose a league and two teams">
        <input type="hidden" name="view" value="compare" />
        <input type="hidden" name="kind" value="teams" />
        <label className="af-rk-field af-rk-field--wide">
          <span>League</span>
          <select name="league" defaultValue={data.leagueId ?? ''}>
            <option value="">Choose a league</option>
            {data.leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.season}
              </option>
            ))}
          </select>
        </label>
        {data.teams.length > 0 ? (
          <>
            {(['a', 'b'] as const).map((k, i) => (
              <label key={k} className="af-rk-field">
                <span>{i === 0 ? 'First team' : 'Second team'}</span>
                <select name={k} defaultValue={data[k]?.rosterId ?? ''}>
                  <option value="">Choose a team</option>
                  {data.teams.map((t) => (
                    <option key={t.rosterId} value={t.rosterId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </>
        ) : null}
        <div className="af-rk-filter-actions">
          <button type="submit" className="af-rk-btn af-rk-btn--primary">
            {data.teams.length > 0 ? 'Compare' : 'Load teams'}
          </button>
        </div>
      </form>

      {data.reason ? (
        <p className="af-rk-empty">{data.reason}</p>
      ) : !data.leagueId ? (
        <p className="af-rk-empty">
          {data.leagues.length === 0 ? 'You have no connected leagues yet.' : 'Choose one of your leagues, then two of its teams.'}
        </p>
      ) : sides.length < 2 ? (
        <p className="af-rk-empty">Choose two teams from {data.leagueName ?? 'this league'}.</p>
      ) : (
        <section className="af-rk-card" style={{ padding: 0 }}>
          <div className="af-rk-tablewrap" role="region" aria-label="Team comparison" tabIndex={0}>
            <table className="af-rk-table">
              <caption className="af-rk-sr">
                {sides[0].name} against {sides[1].name} in {data.leagueName}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{data.leagueName}</th>
                  <th scope="col">
                    {sides[0].name}
                    {sides[0].isYou ? ' (you)' : ''}
                  </th>
                  <th scope="col">
                    {sides[1].name}
                    {sides[1].isYou ? ' (you)' : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sides[0].facts.map((f, i) => {
                  const g = sides[1].facts[i]
                  const lead = f.raw != null && g?.raw != null && f.raw !== g.raw ? ((f.raw > g.raw) === f.higherIsBetter ? 0 : 1) : null
                  return (
                    <tr key={f.label}>
                      <th scope="row">{f.label}</th>
                      <td className={lead === 0 ? 'af-rk-tone-good' : undefined}>{f.value}</td>
                      <td className={lead === 1 ? 'af-rk-tone-good' : undefined}>{g?.value ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="af-rk-note" style={{ padding: '0 16px 16px' }}>
            From this league&apos;s own scored weeks. Both teams play the same schedule length and scoring, so no
            normalisation is needed inside one league.
          </p>
        </section>
      )}
    </>
  )
}

/* ──────────────────────────────── players ───────────────────────────────── */

function PlayersCompare({ data }: { data: PlayerPickData }) {
  const pick = (side: 'a' | 'b', ref: string) =>
    `/core/rankings${qs([
      ['view', 'compare'],
      ['kind', 'players'],
      ['pos', data.position],
      ['qa', data.qa],
      ['qb', data.qb],
      ['a', side === 'a' ? ref : data.a],
      ['b', side === 'b' ? ref : data.b],
    ])}`
  const list = (side: 'a' | 'b') => {
    const matches = side === 'a' ? data.matchesA : data.matchesB
    const q = side === 'a' ? data.qa : data.qb
    const chosen = side === 'a' ? data.a : data.b
    if (q.length < 2) return <p className="af-rk-note">Type at least two letters.</p>
    if (matches.length === 0) {
      return <p className="af-rk-empty">No {data.position ?? ''} player matches “{q}”.</p>
    }
    return (
      <ul className="af-rk-leaguepick" aria-label={side === 'a' ? 'First player results' : 'Second player results'}>
        {matches.map((m) => (
          <li key={m.ref}>
            <Link href={pick(side, m.ref)} aria-current={chosen === m.ref ? 'true' : undefined} scroll={false}>
              <b>{m.name}</b>
              <small>
                {[m.position, m.team, m.sport].filter(Boolean).join(' · ')}
                {m.rosteredIn != null ? ` · in ${m.rosteredIn} of your leagues` : ''}
              </small>
            </Link>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <>
      <form className="af-rk-filters" action="/core/rankings" method="get" aria-label="Find two players">
        <input type="hidden" name="view" value="compare" />
        <input type="hidden" name="kind" value="players" />
        <label className="af-rk-field">
          <span>Position</span>
          <select name="pos" defaultValue={data.position ?? ''}>
            <option value="">Any</option>
            {PLAYER_POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="af-rk-field af-rk-field--wide">
          <span>First player</span>
          <input type="search" name="qa" defaultValue={data.qa} placeholder="Name" autoComplete="off" />
        </label>
        <label className="af-rk-field af-rk-field--wide">
          <span>Second player</span>
          <input type="search" name="qb" defaultValue={data.qb} placeholder="Name" autoComplete="off" />
        </label>
        <div className="af-rk-filter-actions">
          <button type="submit" className="af-rk-btn af-rk-btn--primary">
            Search
          </button>
        </div>
      </form>
      <div className="af-rk-cmpfoot af-rk-cmpfoot--even">
        <section className="af-rk-card">
          <p className="af-rk-eyebrow">First player</p>
          {list('a')}
        </section>
        <section className="af-rk-card">
          <p className="af-rk-eyebrow">Second player</p>
          {list('b')}
        </section>
      </div>
      <section className="af-rk-card">
        {data.compareHref ? (
          <Link className="af-rk-btn af-rk-btn--primary" href={data.compareHref}>
            Open the side-by-side in Player Finder →
          </Link>
        ) : (
          <p className="af-rk-a">Pick one player from each list. The comparison opens in Player Finder, which scores both in each of your leagues with that league&apos;s own settings.</p>
        )}
      </section>
    </>
  )
}
