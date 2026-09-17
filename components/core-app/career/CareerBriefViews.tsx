import Link from 'next/link'
import { careerHref, type BestSeason, type CareerData, type CareerSeasonRow } from '@/lib/core-app/careerModel'
import { TIER_LABEL, type CareerAward } from '@/lib/core-app/careerAwards'
import { TIMELINE_KINDS, TIMELINE_KIND_LABEL, type CareerTimeline } from '@/lib/core-app/careerTimeline'
import { RECORD_SECTIONS, type CareerRecord } from '@/lib/core-app/careerRecordBook'
import type { CareerPeers } from '@/lib/core-app/careerPeers'
import type { CareerCoverageExtras, CareerRecordBook } from '@/lib/core-app/careerScreen'
import { platformLabel } from '@/lib/core-app/rankingsEngine'
import { CareerProgressChart } from './CareerProgressChart'

/**
 * The career brief's views. Every one renders absence as absence: an empty
 * section names what is missing and why, and nothing here prints a zero for a
 * number the data never held.
 */

const nf = (n: number) => n.toLocaleString('en-US')
const pct = (n: number | null) => (n == null ? '—' : `${(Math.round(n * 1000) / 10).toFixed(1)}%`)

/* ── 1. accomplishments first ───────────────────────────────────────────── */

export function AccomplishmentStrip({ data }: { data: CareerData }) {
  const a = data.accomplishments
  const tiles: Array<{ k: string; label: string; value: string; tone?: string; note?: string; muted?: boolean; title?: string }> = [
    { k: 'titles', label: 'Championships', value: nf(a.championships), tone: 'warn' },
    {
      k: 'finals',
      label: 'Finals',
      value: a.finals == null ? 'Not recorded' : nf(a.finals),
      muted: a.finals == null,
      note: a.finals == null ? 'No stored playoff bracket to check' : `${nf(a.championships)} won · ${nf(a.finalsLost)} lost`,
      title: a.finalsNote,
    },
    {
      k: 'playoffs',
      label: 'Playoff berths',
      value: nf(a.playoffAppearances),
      tone: 'good',
      note: a.playoffRate != null ? `${pct(a.playoffRate)} of ${nf(a.playoffKnown)} with a known cut` : 'No league recorded its playoff cut',
    },
    { k: 'win', label: 'Win %', value: pct(a.winRate), tone: 'good', note: a.record ? `${a.record} regular season` : 'No games on record' },
    {
      k: 'year',
      label: 'Best year',
      value: a.bestYear ? String(a.bestYear.season) : '—',
      note: a.bestYear
        ? `${pct(a.bestYear.winRate)} · ${a.bestYear.record}${a.bestYear.championships ? ` · ${a.bestYear.championships} ${a.bestYear.championships === 1 ? 'title' : 'titles'}` : ''}`
        : 'Needs a year with 10+ games',
      muted: !a.bestYear,
    },
  ]
  return (
    <section className="af-crx-acc" aria-label="Accomplishments">
      {tiles.map((t) => (
        <div key={t.k} className="af-crx-acc-tile" data-muted={t.muted ? '' : undefined} title={t.title}>
          <span className="af-crx-acc-l">{t.label}</span>
          <b className={`af-crx-acc-v${t.tone ? ` ${t.tone}` : ''}`}>{t.value}</b>
          {t.note ? <span className="af-crx-acc-n">{t.note}</span> : null}
        </div>
      ))}
    </section>
  )
}

export function BestSeasons({ seasons, filterHref }: { seasons: BestSeason[]; filterHref: (key: string) => string }) {
  if (seasons.length === 0) return null
  return (
    <section className="af-crx-best" aria-label="Best seasons">
      <p className="af-c13-head">Best seasons</p>
      <ol className="af-crx-best-list">
        {seasons.map((b, i) => (
          <li key={`${b.season}-${b.leagueKey}`} className="af-crx-best-card" data-champion={b.champion ? '' : undefined}>
            <span className="af-crx-best-rank">{i + 1}</span>
            <div className="af-crx-best-body">
              <span className="af-crx-best-year">
                {b.season}
                {b.champion ? ' · CHAMPION' : b.madePlayoffs ? ' · PLAYOFFS' : ''}
              </span>
              <Link className="af-crx-best-name" href={filterHref(b.leagueKey)}>
                {b.leagueName}
              </Link>
              <span className="af-crx-best-meta">
                {b.record} · {pct(b.winRate)}
                {b.pointsPerGame != null ? ` · ${b.pointsPerGame.toFixed(1)} ppg` : ''}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ── 8. awards ──────────────────────────────────────────────────────────── */

export function AwardBadge({ award, compact }: { award: CareerAward; compact?: boolean }) {
  return (
    <div className="af-crx-award" data-tier={award.tier} data-compact={compact ? '' : undefined}>
      <span className="af-crx-award-medal" aria-hidden="true">
        {award.name
          .split(' ')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)}
      </span>
      <div className="af-crx-award-body">
        <span className="af-crx-award-tier">
          {TIER_LABEL[award.tier]} · {award.earnedSeason}
        </span>
        <b className="af-crx-award-name">{award.name}</b>
        <span className="af-crx-award-ev">{award.evidence}</span>
        {!compact && award.next ? (
          <span className="af-crx-award-next">
            {nf(award.next.remaining)} more {award.next.remaining === 1 ? award.unitOne : award.unit} for{' '}
            {TIER_LABEL[award.next.tier]}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function AwardsPreview({ awards, href }: { awards: CareerAward[]; href: string }) {
  return (
    <section className="af-c13-card">
      <p className="af-c13-head">
        Awards
        <span className="sp">
          <Link className="af-cr-xplink" href={href}>
            All {awards.length} →
          </Link>
        </span>
      </p>
      {awards.length === 0 ? (
        <p className="af-c13-none">
          No award earned yet. Awards are thresholds on your recorded results — a first title, five
          playoff berths, ten trades — and appear the moment a finished season crosses one.
        </p>
      ) : (
        <div className="af-crx-award-stack">
          {awards.slice(0, 4).map((a) => (
            <AwardBadge key={a.key} award={a} compact />
          ))}
        </div>
      )}
    </section>
  )
}

export function AwardsView({ awards, isEmpty }: { awards: CareerAward[]; isEmpty: boolean }) {
  if (awards.length === 0) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">No awards yet.</p>
        <p className="af-cr-empty-b">
          {isEmpty
            ? 'Awards are earned from finished seasons, and none are on file for this view.'
            : 'Nothing in these seasons crosses an award threshold yet. Every award is a count of something recorded — titles, berths, trades, wins — never an estimate.'}
        </p>
      </div>
    )
  }
  return (
    <div className="af-crx-stack">
      <p className="af-crx-lede">
        {awards.length} {awards.length === 1 ? 'award' : 'awards'} earned. Each one is a threshold on your recorded
        results, dated to the season you crossed it. Share any of them as an image, or{' '}
        <a href="/api/share/career-card?design=awards" target="_blank" rel="noreferrer">
          the whole cabinet
        </a>
        .
      </p>
      <ul className="af-crx-award-grid">
        {awards.map((a) => (
          <li key={a.key} className="af-crx-award-cell">
            <AwardBadge award={a} />
            <p className="af-crx-award-blurb">{a.blurb}</p>
            <a
              className="af-cr-btn af-cr-btn--ghost"
              href={`/api/share/career-card?design=award&award=${encodeURIComponent(a.key)}`}
              target="_blank"
              rel="noreferrer"
            >
              Share image →
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── 2. timeline ────────────────────────────────────────────────────────── */

export function TimelineView({ timeline, data }: { timeline: CareerTimeline | null; data: CareerData }) {
  if (!timeline) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">We could not build your timeline just now.</p>
        <p className="af-cr-empty-b">This is a read failure on our side, not an empty career.</p>
      </div>
    )
  }
  const kindHref = (k: string | null) => careerHref(data.filter, { view: 'timeline', kind: k })
  return (
    <div className="af-crx-stack">
      <div className="af-cr-filter" role="group" aria-label="Event type">
        <Link className="af-cr-filter-opt" aria-current={timeline.kind == null ? 'true' : undefined} href={kindHref(null)}>
          Everything
        </Link>
        {TIMELINE_KINDS.map((k) => (
          <Link key={k} className="af-cr-filter-opt" aria-current={timeline.kind === k ? 'true' : undefined} href={kindHref(k)}>
            {TIMELINE_KIND_LABEL[k]} · {nf(timeline.counts[k])}
          </Link>
        ))}
      </div>
      {timeline.seasons.length === 0 ? (
        <p className="af-c13-none">
          {timeline.kind
            ? `No ${TIMELINE_KIND_LABEL[timeline.kind].toLowerCase()} on file for this view.`
            : 'Nothing on file for this view yet.'}
        </p>
      ) : (
        <ol className="af-crx-tl">
          {timeline.seasons.map((s) => (
            <li key={s.season} className="af-crx-tl-season">
              <div className="af-crx-tl-year">
                <b>{s.season}</b>
                {s.record ? <span>{s.record}</span> : null}
                {s.titles ? <span className="warn">{s.titles === 1 ? '1 title' : `${s.titles} titles`}</span> : null}
              </div>
              <ul className="af-crx-tl-events">
                {s.events.map((e) => (
                  <li key={e.key} className="af-crx-tl-event" data-kind={e.kind} data-tone={e.tone}>
                    <span className="af-crx-tl-kind">{TIMELINE_KIND_LABEL[e.kind]}</span>
                    <div className="af-crx-tl-body">
                      <p className="af-crx-tl-title">
                        {e.key.startsWith('trade:more:') ? (
                          <Link
                            href={careerHref(
                              { ...data.filter, fromSeason: e.season, toSeason: e.season },
                              { view: 'timeline', kind: 'trade' },
                            )}
                          >
                            {e.title}
                          </Link>
                        ) : (
                          e.title
                        )}
                        {e.date ? (
                          <time dateTime={e.date} className="af-crx-tl-date">
                            {new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          </time>
                        ) : null}
                      </p>
                      {e.detail ? <p className="af-crx-tl-detail">{e.detail}</p> : null}
                      {e.items && e.items.length > 0 ? (
                        <details className="af-crx-tl-more">
                          <summary>
                            {e.items.length + (e.more ?? 0)} {e.items.length + (e.more ?? 0) === 1 ? 'entry' : 'entries'}
                          </summary>
                          <ul>
                            {e.items.map((it) => (
                              <li key={it}>{it}</li>
                            ))}
                            {e.more ? <li className="af-crx-muted">and {e.more} more</li> : null}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {timeline.notes.map((n) => (
        <p key={n} className="af-c13-note">
          {n}
        </p>
      ))}
    </div>
  )
}

/* ── 6. progress ────────────────────────────────────────────────────────── */

export function ProgressView({ data, peers }: { data: CareerData; peers: CareerPeers | null }) {
  if (data.seasons.length === 0) {
    return <p className="af-c13-none">No finished seasons in this view, so there is no progression to draw.</p>
  }
  return (
    <div className="af-crx-stack">
      <section className="af-c13-card">
        <p className="af-c13-head">Career progression · {data.firstSeason}–{data.lastSeason}</p>
        <CareerProgressChart seasons={data.seasons} rank={peers ? peers.rankBySeason : []} />
      </section>
      <SeasonTable seasons={data.seasons} />
    </div>
  )
}

export function SeasonTable({ seasons }: { seasons: CareerSeasonRow[] }) {
  const rows = [...seasons].sort((a, b) => b.season - a.season)
  return (
    <div className="af-crx-tablewrap">
      <table className="af-crx-table">
        <caption>Every season, most recent first</caption>
        <thead>
          <tr>
            <th scope="col">Season</th>
            <th scope="col">Leagues</th>
            <th scope="col">Record</th>
            <th scope="col">Win %</th>
            <th scope="col">Pts / g</th>
            <th scope="col">Playoffs</th>
            <th scope="col">Titles</th>
            <th scope="col">Best league</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.season}>
              <th scope="row">{s.season}</th>
              <td>{s.leagueCount}</td>
              <td>
                {s.wins}-{s.losses}
                {s.ties ? `-${s.ties}` : ''}
              </td>
              <td>{pct(s.winRate)}</td>
              <td>{s.pointsPerGame == null ? '—' : s.pointsPerGame.toFixed(1)}</td>
              <td>{s.playoffKnownCount ? `${s.playoffAppearances} / ${s.playoffKnownCount}` : '—'}</td>
              <td className={s.championships ? 'warn' : undefined}>{s.championships || '—'}</td>
              <td className="af-crx-table-name">
                {s.best ? `${s.best.leagueName} (${s.best.record}${s.best.champion ? ', champion' : ''})` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── 10. mobile story ───────────────────────────────────────────────────── */

export function SeasonStoryRail({ data }: { data: CareerData }) {
  const seasons = [...data.seasons].sort((a, b) => b.season - a.season)
  if (seasons.length === 0) return null
  return (
    <section className="af-crx-story" aria-label="Season stories — swipe for earlier seasons">
      <div className="af-crx-story-head">
        <h2 className="af-crm-cardtitle">SEASON BY SEASON</h2>
        <span className="af-crx-muted">swipe →</span>
      </div>
      <ol className="af-crx-story-rail">
        {seasons.map((s) => (
          <li key={s.season} className="af-crx-story-card" data-title={s.championships ? '' : undefined}>
            <span className="af-crx-story-year">{s.season}</span>
            <b className="af-crx-story-record">
              {s.wins}-{s.losses}
              {s.ties ? `-${s.ties}` : ''}
            </b>
            <span className="af-crx-story-rate">{pct(s.winRate)} win rate</span>
            <ul className="af-crx-story-facts">
              <li>
                {s.leagueCount} {s.leagueCount === 1 ? 'league' : 'leagues'} finished
              </li>
              {s.championships ? <li className="warn">{s.championships === 1 ? '1 championship' : `${s.championships} championships`}</li> : null}
              {s.playoffKnownCount ? (
                <li>
                  {s.playoffAppearances} of {s.playoffKnownCount} made the playoffs
                </li>
              ) : null}
              {s.pointsPerGame != null ? <li>{s.pointsPerGame.toFixed(1)} points a game</li> : null}
            </ul>
            {s.best ? (
              <p className="af-crx-story-best">
                Best: {s.best.leagueName} · {s.best.record}
              </p>
            ) : null}
            <Link className="af-crx-story-link" href={careerHref({ ...data.filter, fromSeason: s.season, toSeason: s.season })}>
              Open {s.season}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ── 7. peers ───────────────────────────────────────────────────────────── */

export function PeersView({ peers }: { peers: CareerPeers | null }) {
  if (!peers) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">We could not read the comparison just now.</p>
        <p className="af-cr-empty-b">This is a read failure on our side.</p>
      </div>
    )
  }
  const v = peers.vsLeagues
  const pts = v.points
  const yourPpg = pts.yourGames > 0 ? pts.yourPoints / pts.yourGames : null
  const leaguePpg = pts.leagueTeamGames > 0 ? pts.leaguePoints / pts.leagueTeamGames : null
  const rows: Array<{ label: string; you: string; them: string; ahead: boolean | null; note: string }> = [
    {
      label: 'Win rate',
      you: pct(v.winRate),
      them: '50.0%',
      ahead: v.winRate == null ? null : v.winRate >= 0.5,
      note: `${nf(peers.you.sample.games)} games — every league averages .500 by definition`,
    },
    {
      label: 'Championships',
      you: nf(v.titles.won),
      them: v.titles.completed ? v.titles.expected.toFixed(1) : '—',
      ahead: v.titles.completed ? v.titles.won >= v.titles.expected : null,
      note: v.titles.completed
        ? `expected from one-in-N odds across ${nf(v.titles.completed)} finished league-seasons`
        : 'no finished league-season to judge',
    },
    {
      label: 'Playoff berths',
      you: nf(v.playoffs.made),
      them: v.playoffs.judged ? v.playoffs.expected.toFixed(1) : '—',
      ahead: v.playoffs.judged ? v.playoffs.made >= v.playoffs.expected : null,
      note: v.playoffs.judged
        ? `expected from each league's own cut across ${nf(v.playoffs.judged)} seasons`
        : 'no league recorded its playoff cut',
    },
    {
      label: 'Points per game',
      you: yourPpg == null ? '—' : yourPpg.toFixed(1),
      them: leaguePpg == null ? '—' : leaguePpg.toFixed(1),
      ahead: yourPpg == null || leaguePpg == null ? null : yourPpg >= leaguePpg,
      note:
        leaguePpg == null
          ? 'no weekly scores on file for your teams'
          : `every team in the same ${nf(pts.leagueSeasons)} league-seasons, ${nf(pts.yourGames)} of your games`,
    },
    {
      label: 'Scoring index',
      you: v.scoringIndex == null ? '—' : v.scoringIndex.toFixed(1),
      them: '100.0',
      ahead: v.scoringIndex == null ? null : v.scoringIndex >= 100,
      note:
        v.scoringIndex == null
          ? 'no season with points has a comparable format group yet'
          : `vs the average AllFantasy team in the same format, over ${nf(v.pricedGames)} games`,
    },
  ]
  return (
    <div className="af-crx-stack">
      <section className="af-c13-card">
        <p className="af-c13-head">You vs your leagues</p>
        <div className="af-crx-tablewrap">
          <table className="af-crx-table">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">You</th>
                <th scope="col">League expectation</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className={r.ahead == null ? undefined : r.ahead ? 'good' : 'bad'}>{r.you}</td>
                  <td>{r.them}</td>
                  <td className="af-crx-table-name">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="af-c13-card">
        <p className="af-c13-head">
          You vs managers in your formats
          <span className="sp">{nf(peers.population)} ranked managers</span>
        </p>
        {!peers.ranked ? (
          <p className="af-c13-note">
            Your account has not been ranked yet, so it is compared from your own records without a place on the board.
          </p>
        ) : null}
        {peers.cohorts.length === 0 ? (
          <p className="af-c13-none">
            No format has enough other managers to compare against — a comparison needs at least two others with three or
            more seasons of results in the same kind of league. With {nf(peers.population)} ranked managers today, most
            formats do not.
          </p>
        ) : (
          peers.cohorts.map((c) => (
            <div key={c.key} className="af-crx-cohort">
              <p className="af-crx-cohort-h">
                <b>{c.label}</b>
                <span>
                  {c.rank != null ? `#${c.rank} of ${c.of}` : 'not placed'} · {nf(c.peers)} others · your sample {nf(c.yourSample)}
                </span>
              </p>
              <div className="af-crx-tablewrap">
                <table className="af-crx-table">
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col">You</th>
                      <th scope="col">Peer median</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.metrics.map((m) => (
                      <tr key={m.key}>
                        <th scope="row">{m.label}</th>
                        <td className={m.ahead == null ? undefined : m.ahead ? 'good' : 'bad'}>{m.youLabel}</td>
                        <td>{m.medianLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
        <p className="af-c13-note">
          Both sides are scored from the rankings ledger, which dates and dedupes a few league-seasons differently from
          the overview — so a game count here can differ slightly from the record there. Scored with the same engine as{' '}
          <Link href="/core/rankings">Rankings</Link>, over the same platform, sport and seasons you have filtered to.
          Adjusted win rate blends in 14 games at .500 so a short record cannot top a long one.
        </p>
      </section>
    </div>
  )
}

/* ── 5. record book ─────────────────────────────────────────────────────── */

export function RecordBookView({ book }: { book: CareerRecordBook | null }) {
  if (!book) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">We could not read your records just now.</p>
        <p className="af-cr-empty-b">This is a read failure on our side, not a career with nothing in it.</p>
      </div>
    )
  }
  const all: CareerRecord[] = [...(book.weekly?.records ?? []), ...book.seasons, ...book.trades, ...book.drafts]
  const weekly = book.weekly
  return (
    <div className="af-crx-stack">
      {weekly && weekly.weeksCounted > 0 ? (
        <p className="af-crx-lede">
          Weekly records come from {nf(weekly.weeksCounted)} played games across {nf(weekly.leaguesCounted)}{' '}
          {weekly.leaguesCounted === 1 ? 'league' : 'leagues'}
          {weekly.weeklySeasons.length
            ? `, ${weekly.weeklySeasons[weekly.weeklySeasons.length - 1].season}–${weekly.weeklySeasons[0].season}`
            : ''}
          . Season records reach back to your first imported season.
        </p>
      ) : (
        <p className="af-crx-lede">
          No weekly games are on file for your claimed teams, so the single-week, streak and rivalry records are empty.
          Season, trade and draft records below come from your imported history.
        </p>
      )}
      {RECORD_SECTIONS.map((sec) => {
        const list = all.filter((r) => r.section === sec.key)
        const missing = book.missing.filter((m) => m.section === sec.key)
        if (list.length === 0 && missing.length === 0) {
          return (
            <section key={sec.key} className="af-crx-rsec" aria-labelledby={`af-rsec-${sec.key}`}>
              <h3 id={`af-rsec-${sec.key}`} className="af-crx-rsec-h">
                {sec.label}
              </h3>
              <p className="af-c13-none">{EMPTY_SECTION[sec.key]}</p>
            </section>
          )
        }
        return (
          <section key={sec.key} className="af-crx-rsec" aria-labelledby={`af-rsec-${sec.key}`}>
            <h3 id={`af-rsec-${sec.key}`} className="af-crx-rsec-h">
              {sec.label}
            </h3>
            {list.length > 0 ? (
              <ul className="af-bd-grid">
                {list.map((r) => (
                  <li key={r.key} className="af-bd-statcard">
                    <span className="af-bd-statcard-k">{r.label}</span>
                    <span className="af-bd-statcard-v" data-sev={r.tone}>
                      {r.value}
                    </span>
                    <span className="af-bd-statcard-c">{r.context}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {missing.map((m) => (
              <p key={m.label} className="af-c13-note">
                <b>{m.label}</b> is not here: {m.reason}.
              </p>
            ))}
            {sec.key === 'trades' && book.ungradedLeagues > 0 ? (
              <p className="af-c13-note">
                {nf(book.ungradedLeagues)} of your Sleeper leagues have not had their trades graded yet, so their trades
                count toward volume but not toward best and worst.
              </p>
            ) : null}
          </section>
        )
      })}
      {weekly && weekly.rivals.length > 0 ? (
        <section className="af-crx-rsec" aria-labelledby="af-rsec-rivals">
          <h3 id="af-rsec-rivals" className="af-crx-rsec-h">
            Rivalry ledger
          </h3>
          <div className="af-crx-tablewrap">
            <table className="af-crx-table">
              <thead>
                <tr>
                  <th scope="col">Opponent</th>
                  <th scope="col">Meetings</th>
                  <th scope="col">Record</th>
                  <th scope="col">Points</th>
                  <th scope="col">Where</th>
                </tr>
              </thead>
              <tbody>
                {weekly.rivals.map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.name}</th>
                    <td>{r.meetings}</td>
                    <td className={r.wins > r.losses ? 'good' : r.wins < r.losses ? 'bad' : undefined}>
                      {r.wins}-{r.losses}
                      {r.ties ? `-${r.ties}` : ''}
                    </td>
                    <td>
                      {nf(Math.round(r.pointsFor))}–{nf(Math.round(r.pointsAgainst))}
                    </td>
                    <td className="af-crx-table-name">
                      {r.leagues.slice(0, 2).join(', ')}
                      {r.leagues.length > 2 ? ` +${r.leagues.length - 2}` : ''} · {r.seasons[0]}
                      {r.seasons.length > 1 ? `–${r.seasons[r.seasons.length - 1]}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

const EMPTY_SECTION: Record<string, string> = {
  scoring: 'No played week is on file for any team you have claimed, so there is no single-week record to take.',
  streaks: 'No streak can be measured without weekly games or consecutive recorded seasons.',
  seasons: 'No finished league-season with games is on file for this view.',
  trades: 'No trade of yours is on file for this view.',
  drafts: 'No draft pick of yours is on file for this view.',
  rivalries: 'No head-to-head game is on file for your claimed teams.',
}

/* ── 4. completeness ────────────────────────────────────────────────────── */

export function CoverageView({ data, extras }: { data: CareerData; extras: CareerCoverageExtras | null }) {
  const c = data.coverage
  const weekly = new Map((extras?.weeklySeasons ?? []).map((w) => [w.season, w]))
  const drafts = new Set(extras?.draftSeasons ?? [])
  const trades = new Set(extras?.tradeSeasons ?? [])
  const seasons = [...new Set([...c.seasons.map((s) => s.season), ...weekly.keys(), ...drafts, ...trades])].sort((a, b) => b - a)
  const bySeason = new Map(c.seasons.map((s) => [s.season, s]))
  const mark = (ok: boolean, partial?: boolean) => (ok ? (partial ? 'partial' : 'yes') : 'no')

  return (
    <div className="af-crx-stack">
      <section className="af-c13-card">
        <p className="af-c13-head">What is on file</p>
        {c.platforms.length === 0 ? (
          <p className="af-c13-none">Nothing has been imported for this view yet.</p>
        ) : (
          <ul className="af-crx-cov-plats">
            {c.platforms.map((p) => (
              <li key={p.platform}>
                <b>{platformLabel(p.platform)}</b> · {nf(p.leagueSeasons)} league-seasons ·{' '}
                {p.firstSeason === p.lastSeason ? p.firstSeason : `${p.firstSeason}–${p.lastSeason}`}
              </li>
            ))}
          </ul>
        )}
        <ul className="af-crx-cov-notes">
          {c.rosterless > 0 ? (
            <li>
              {nf(c.rosterless)} Sleeper {c.rosterless === 1 ? 'league was' : 'leagues were'} imported without a roster of
              yours, so {c.rosterless === 1 ? 'it is' : 'they are'} not counted.
            </li>
          ) : null}
          {c.missingPoints > 0 ? (
            <li>{nf(c.missingPoints)} finished league-seasons have a record but no points, so scoring comparisons skip them.</li>
          ) : null}
          {c.missingPlayoffs > 0 ? (
            <li>
              {nf(c.missingPlayoffs)} finished league-seasons come from a source that cannot say whether you made the
              playoffs.
            </li>
          ) : null}
          {data.activeLeagues.length > 0 ? (
            <li>
              {nf(data.activeLeagues.length)} league-seasons are still being played and are not in any total until they finish.
            </li>
          ) : null}
          {extras && extras.ungradedLeagues > 0 ? (
            <li>{nf(extras.ungradedLeagues)} Sleeper leagues have not had their trades graded.</li>
          ) : null}
          <li>{data.accomplishments.finalsNote}</li>
          {data.accomplishments.finalsUncountedTitles > 0 ? (
            <li>
              {nf(data.accomplishments.finalsUncountedTitles)} Sleeper playoff{' '}
              {data.accomplishments.finalsUncountedTitles === 1 ? 'bracket names' : 'brackets name'} you champion in a
              season whose source does not record the title, so {data.accomplishments.finalsUncountedTitles === 1 ? 'it counts' : 'they count'}{' '}
              as neither a title nor a final.
            </li>
          ) : null}
        </ul>
      </section>

      {seasons.length > 0 ? (
        <div className="af-crx-tablewrap">
          <table className="af-crx-table af-crx-cov">
            <caption>Season by season — what each part of your history was built from</caption>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">League-seasons</th>
                <th scope="col">Finished</th>
                <th scope="col">Records</th>
                <th scope="col">Points</th>
                <th scope="col">Playoff cut</th>
                <th scope="col">Weekly scores</th>
                <th scope="col">Drafts</th>
                <th scope="col">Trades</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((season) => {
                const s = bySeason.get(season)
                const w = weekly.get(season)
                return (
                  <tr key={season}>
                    <th scope="row">{season}</th>
                    <td>{s ? `${nf(s.onFile)} · ${s.platforms.map(platformLabel).join(', ')}` : '—'}</td>
                    <td>{s ? `${nf(s.counted)}${s.inProgress ? ` (+${s.inProgress} live)` : ''}` : '—'}</td>
                    <td data-cov={s ? mark(s.withRecord > 0, s.withRecord < s.onFile) : 'no'}>
                      {s ? `${nf(s.withRecord)} / ${nf(s.onFile)}` : '—'}
                    </td>
                    <td data-cov={s ? mark(s.withPoints > 0, s.withPoints < s.withRecord) : 'no'}>
                      {s ? nf(s.withPoints) : '—'}
                    </td>
                    <td data-cov={s ? mark(s.withPlayoffCut > 0, s.withPlayoffCut < s.onFile) : 'no'}>
                      {s ? nf(s.withPlayoffCut) : '—'}
                    </td>
                    <td data-cov={mark(!!w)}>{extras ? (w ? `${nf(w.weeks)} games · ${w.leagues} lg` : 'none') : '—'}</td>
                    <td data-cov={mark(drafts.has(season))}>{extras ? (drafts.has(season) ? 'yes' : 'none') : '—'}</td>
                    <td data-cov={mark(trades.has(season))}>{extras ? (trades.has(season) ? 'yes' : 'none') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="af-c13-note">
        Totals on every tab count finished seasons only. Weekly scores, drafts and trades come from separate imports, so
        a season can have a record without them — the table says which parts arrived.{' '}
        <Link href="/import?returnTo=%2Fcore%2Fcareer%3Fview%3Dcoverage">Import more history</Link>.
      </p>
    </div>
  )
}

export function CoverageSummaryCard({ data, href }: { data: CareerData; href: string }) {
  const c = data.coverage
  const seasons = c.seasons.filter((s) => s.counted > 0)
  const withPoints = seasons.filter((s) => s.withPoints > 0).length
  return (
    <section className="af-c13-card">
      <p className="af-c13-head">
        Completeness
        <span className="sp">
          <Link className="af-cr-xplink" href={href}>
            Details →
          </Link>
        </span>
      </p>
      <p className="af-crx-cov-line">
        {seasons.length} {seasons.length === 1 ? 'season' : 'seasons'} imported
        {seasons.length ? ` (${seasons[seasons.length - 1].season}–${seasons[0].season})` : ''} from{' '}
        {c.platforms.map((p) => platformLabel(p.platform)).join(', ') || 'no platform'}.
      </p>
      <p className="af-c13-note">
        Points on file for {withPoints} of {seasons.length} seasons.
        {c.rosterless ? ` ${c.rosterless} leagues without your roster are left out.` : ''}
        {data.activeLeagues.length ? ` ${data.activeLeagues.length} live league-seasons wait to finish.` : ''}
      </p>
    </section>
  )
}
