'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { MyLeaguesData, MyLeaguesLeague, MyLeaguesTier } from '@/lib/core-app/myLeagues'
// af-core.css carries the .af-core token layer (--surface, --line, --chip, --accent,
// the --p-* platform pairs …) that every rule in af-my-leagues.css reads. This screen
// renders at /leagues inside ProductShellLayout rather than inside AfCoreShell, so
// without this import — and without `af-core` on the root element below — every var()
// resolves to the empty string and the page paints as unstyled boxes. Same failure and
// same two-part fix as PricingV4, LandingV4 and AuthV4, each of which carries the note.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-my-leagues.css'

/**
 * Screen 21a — "My Leagues, at 61 live".
 *
 * ⚠ SORT ORDER IS URGENCY AND MUST NOT REGRESS TO ALPHABETICAL — the handoff's
 * first copy-contract line. The order is not computed here: the server hands
 * these rows over already ranked by the 34a ranker, and every filter below is
 * `Array.prototype.filter`, which is order-preserving. There is no `.sort()` in
 * this file, deliberately.
 *
 * ⚠ THREE THINGS THE HANDOFF DRAWS ARE ABSENT, AND THE SCREEN SAYS SO RATHER
 * THAN FILLING THEM IN. The design's "Playing now" cards carry a live score vs
 * opponent and a win probability, and its quiet tiles carry record + rank. On
 * this database `LeagueTeam` rows with any result number **0 of 893**, no
 * current-season scored matchup joins a league id at all, and there is no
 * win-probability model behind a league list. So those lines are omitted and the
 * withheld list is printed under the tiers — see the loader's header for the
 * counts. Rendering 0–0 instead would present the absence of a result as a
 * result, which is the failure this product has a standing rule against.
 *
 * What IS real, and is what the tiers key on: an unavailable starter, a draft in
 * progress, a flagged player, and being the person accountable for the league.
 * Every "needs you" reason is therefore a specific cause, never a generic
 * "action needed" — the handoff's second copy-contract line.
 *
 * ⚠ EVERY COUNT ON THIS PAGE IS DERIVED FROM THE ROWS IN VIEW. The handoff's
 * chip counts (7 / 12 / 23 / 4 / 19 / 38) are its own account's numbers, not
 * constants: they are computed server-side in `getMyLeaguesData` and the "+N
 * more" tiles below are `total - shown`, so a cap can never silently under-report.
 */

export type MyLeaguesV4Props = MyLeaguesData & {
  /** Where the "Import more" actions go. */
  importHref: string
  /** The add-league / re-sync surface this screen replaced at /leagues. */
  syncHref: string
}

type ChipKey = 'needs' | 'playing' | 'commissioner' | 'drafting' | 'dynasty' | 'quiet'
type ViewMode = 'grid' | 'list'

const TIER_META: Record<
  MyLeaguesTier,
  { title: string; blurb: string; anchor: string }
> = {
  needs: {
    title: 'Needs you',
    blurb: 'Sorted by what is blocking, not by name.',
    anchor: 'af-ml-needs',
  },
  playing: {
    title: 'In season',
    /*
     * ⚠ THE HANDOFF CALLS THIS TIER "PLAYING NOW" AND PUTS A LIVE SCORE ON IT.
     * Renaming it is the honest half of omitting the score: "Playing now" beside
     * a card with no score reads as a broken score, where "In season" is a claim
     * this data actually supports.
     */
    blurb: 'Rosters read, nothing blocking. Live scores are not ingested yet, so these carry no score.',
    anchor: 'af-ml-playing',
  },
  quiet: {
    title: 'Everything else',
    blurb: 'Looked at and cleared — nothing here needs you today.',
    anchor: 'af-ml-quiet',
  },
}

/** Grid caps per tier, mirroring the handoff's 3-up / 4-up / 6-up density. */
const TIER_CAP: Record<MyLeaguesTier, number> = { needs: 6, playing: 8, quiet: 12 }

function platformLabel(p: string): string {
  const key = p.toLowerCase()
  if (key === 'allfantasy') return 'AllFantasy'
  if (key === 'espn') return 'ESPN'
  if (key === 'mfl') return 'MFL'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * ⚠ ITERATE CODE POINTS, NOT UTF-16 UNITS. `name[0]` on "🪓 Elimination Station"
 * cuts a surrogate pair in half; the server and client then serialise the lone
 * surrogate differently and React replaces the whole document with client
 * content. That exact bug shipped on the 34a rail — same league names, same fix.
 */
function initials(name: string): string {
  const chars = Array.from(name.trim()).filter((ch) => /[a-z0-9]/i.test(ch))
  return chars.slice(0, 2).join('').toUpperCase() || '—'
}

export function MyLeaguesV4({
  leagues,
  history,
  counts,
  platforms,
  coverage,
  notice,
  importHref,
  syncHref,
}: MyLeaguesV4Props) {
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState<string>('all')
  const [showHistory, setShowHistory] = useState(false)
  const [view, setView] = useState<ViewMode>('grid')
  const [chip, setChip] = useState<ChipKey | null>(null)
  const [expanded, setExpanded] = useState<Partial<Record<MyLeaguesTier, boolean>>>({})

  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    return leagues.filter((l) => {
      if (platform !== 'all' && String(l.platform).toLowerCase() !== platform) return false
      if (q && !l.name.toLowerCase().includes(q)) return false
      if (chip === 'needs' && l.tier !== 'needs') return false
      if (chip === 'playing' && l.tier !== 'playing') return false
      if (chip === 'quiet' && l.tier !== 'quiet') return false
      if (chip === 'commissioner' && !l.isCommissioner) return false
      if (chip === 'dynasty' && !l.isDynasty) return false
      if (
        chip === 'drafting' &&
        !(l.priority === 'draft' || (l.chips ?? []).some((c) => c.label === 'PRE DRAFT'))
      ) {
        return false
      }
      return true
    })
  }, [leagues, platform, q, chip])

  /* History is only searched when the "+ history" toggle is on — the handoff's
     "543 past seasons searchable via + history". */
  const filteredHistory = useMemo(() => {
    if (!showHistory) return []
    return history.filter((h) => {
      if (platform !== 'all' && h.platform !== platform) return false
      if (q && !h.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [history, showHistory, platform, q])

  const tiers: MyLeaguesTier[] = ['needs', 'playing', 'quiet']
  const byTier = useMemo(() => {
    const map: Record<MyLeaguesTier, MyLeaguesLeague[]> = { needs: [], playing: [], quiet: [] }
    for (const l of filtered) map[l.tier].push(l)
    return map
  }, [filtered])

  const nothingMatches = filtered.length === 0 && filteredHistory.length === 0

  const CHIPS: Array<{ key: ChipKey; label: string; count: number }> = [
    { key: 'needs', label: 'Needs you', count: counts.needs },
    { key: 'playing', label: 'In season', count: counts.playing },
    { key: 'commissioner', label: 'You commission', count: counts.commissioner },
    { key: 'drafting', label: 'Drafting soon', count: counts.drafting },
    { key: 'dynasty', label: 'Dynasty', count: counts.dynasty },
    { key: 'quiet', label: 'Quiet', count: counts.quiet },
  ]

  return (
    <div className="af-core af-ml">
      <header className="af-ml-head">
        <div className="af-ml-headline">
          <h1 className="af-ml-title">My leagues</h1>
          <p className="af-ml-sub">
            <strong>{counts.live}</strong> live
            {counts.history > 0 ? (
              <>
                {' '}· <strong>{counts.history}</strong> finished season
                {counts.history === 1 ? '' : 's'} in history
              </>
            ) : null}
          </p>
        </div>

        <div className="af-ml-actions">
          <Link href={syncHref} className="af-ml-btn af-ml-btn--ghost">
            Sync &amp; connect
          </Link>
          <Link href={importHref} className="af-ml-btn">
            Import more
          </Link>
        </div>
      </header>

      {/* ── Controls: search · platform · live/history · grid/list ───────── */}
      <div className="af-ml-controls">
        <label className="af-ml-search">
          <span className="af-ml-search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              showHistory
                ? `Search ${counts.all} leagues and past seasons`
                : `Search ${counts.live} live leagues`
            }
            aria-label="Search leagues"
            className="af-ml-search-input"
          />
        </label>

        <label className="af-ml-select">
          <span className="af-ml-select-label">Platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            aria-label="Filter by platform"
          >
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {platformLabel(p)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="af-ml-toggle"
          data-on={showHistory}
          onClick={() => setShowHistory((v) => !v)}
          aria-pressed={showHistory}
        >
          {showHistory ? 'Live + history' : '+ history'}
        </button>

        <div className="af-ml-view" role="group" aria-label="View mode">
          <button
            type="button"
            className="af-ml-view-btn"
            data-on={view === 'grid'}
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
          >
            Grid
          </button>
          <button
            type="button"
            className="af-ml-view-btn"
            data-on={view === 'list'}
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
          >
            List
          </button>
        </div>
      </div>

      {/* Filter chips — counts are the whole account, so they stay stable as you filter. */}
      <div className="af-ml-chips">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            className="af-ml-chip"
            data-on={chip === c.key}
            onClick={() => setChip((cur) => (cur === c.key ? null : c.key))}
            aria-pressed={chip === c.key}
          >
            {c.label} <span className="af-ml-chip-n af-num">{c.count}</span>
          </button>
        ))}
        {chip ? (
          <button type="button" className="af-ml-chip af-ml-chip--clear" onClick={() => setChip(null)}>
            Clear filter
          </button>
        ) : null}
      </div>

      {/*
        The account-wide "nothing has ever been read" notice — one fact about the
        account, stated once, rather than once per league. Repeating it per row is
        what produced the original 604-issue flood this screen exists to replace.
      */}
      {notice ? (
        <div className="af-ml-notice" role="status">
          <div>
            <strong className="af-ml-notice-t">{notice.title}</strong>
            <p className="af-ml-notice-p">{notice.body}</p>
          </div>
          {notice.href ? (
            <Link href={notice.href} className="af-ml-btn af-ml-btn--ghost">
              {notice.label ?? 'Check your connections'}
            </Link>
          ) : null}
        </div>
      ) : null}

      {nothingMatches ? (
        <div className="af-ml-empty">
          <p className="af-ml-empty-t">Nothing matches those filters</p>
          <p className="af-ml-empty-p">
            {counts.live === 0
              ? 'No leagues are connected to this account yet.'
              : 'Try a different platform, clear the chip filter, or turn on “+ history” to search past seasons.'}
          </p>
          <div className="af-ml-empty-actions">
            {counts.live === 0 ? (
              <Link href={importHref} className="af-ml-btn">
                Import a league
              </Link>
            ) : (
              <button
                type="button"
                className="af-ml-btn af-ml-btn--ghost"
                onClick={() => {
                  setQuery('')
                  setPlatform('all')
                  setChip(null)
                }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* ── The three tiers ──────────────────────────────────────────────── */}
      {tiers.map((tier) => {
        const all = byTier[tier]
        if (all.length === 0) return null
        const cap = TIER_CAP[tier]
        const isOpen = expanded[tier] === true
        const shown = isOpen ? all : all.slice(0, cap)
        const rest = all.length - shown.length
        const meta = TIER_META[tier]

        return (
          <section key={tier} className="af-ml-tier" id={meta.anchor} data-tier={tier}>
            <div className="af-ml-tier-head">
              <h2 className="af-ml-tier-title">
                {meta.title} <span className="af-ml-tier-n af-num">{all.length}</span>
              </h2>
              <p className="af-ml-tier-blurb">{meta.blurb}</p>
            </div>

            <div className="af-ml-grid" data-tier={tier} data-view={view}>
              {shown.map((l) => (
                <LeagueCard key={l.id} league={l} tier={tier} view={view} />
              ))}

              {/*
                ⚠ THE OVERFLOW TILE IS A BUTTON THAT EXPANDS, NOT A DEAD COUNT.
                The handoff draws "4 more need you" and "+9 more" as links to the
                full list; the full list is this same section, so expanding in
                place is the honest equivalent and costs no route.
              */}
              {rest > 0 ? (
                <button
                  type="button"
                  className="af-ml-more"
                  onClick={() => setExpanded((e) => ({ ...e, [tier]: true }))}
                >
                  <span className="af-ml-more-n af-num">+{rest}</span>
                  <span className="af-ml-more-l">
                    more {tier === 'needs' ? 'need you' : tier === 'playing' ? 'in season' : 'quiet'}
                  </span>
                </button>
              ) : null}
            </div>

            {isOpen && all.length > cap ? (
              <button
                type="button"
                className="af-ml-collapse"
                onClick={() => setExpanded((e) => ({ ...e, [tier]: false }))}
              >
                Show fewer
              </button>
            ) : null}
          </section>
        )
      })}

      {/* ── History ──────────────────────────────────────────────────────── */}
      {showHistory && filteredHistory.length > 0 ? (
        <section className="af-ml-tier" id="af-ml-history">
          <div className="af-ml-tier-head">
            <h2 className="af-ml-tier-title">
              Past seasons <span className="af-ml-tier-n af-num">{filteredHistory.length}</span>
            </h2>
            <p className="af-ml-tier-blurb">
              Finished seasons from your career import. These are records, not leagues you play —
              they live in Career &amp; Legacy.
            </p>
          </div>
          <div className="af-ml-hist">
            {filteredHistory.slice(0, 60).map((h) => (
              <Link key={h.id} href="/core/career" className="af-ml-hist-row">
                <span className="af-ml-hist-name">{h.name}</span>
                <span className="af-ml-hist-meta af-num">
                  {h.season ?? '—'} · {platformLabel(h.platform)}
                </span>
              </Link>
            ))}
          </div>
          {filteredHistory.length > 60 ? (
            <p className="af-ml-hist-note">
              Showing 60 of {filteredHistory.length} matching seasons. Career &amp; Legacy holds the
              full board.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── Footer banner ────────────────────────────────────────────────── */}
      <footer className="af-ml-foot">
        <div>
          <strong className="af-ml-foot-t">
            {counts.history > 0
              ? `${counts.history} past season${counts.history === 1 ? '' : 's'} on the board`
              : 'No past seasons imported yet'}
          </strong>
          <p className="af-ml-foot-p">
            {counts.history > 0
              ? 'Career imports are kept out of the live list so they cannot drown it. Search them with “+ history”.'
              : 'Import a career history to fill the board.'}
          </p>
        </div>
        <div className="af-ml-foot-actions">
          <Link href="/core/career" className="af-ml-btn af-ml-btn--ghost">
            Browse history
          </Link>
          <Link href={importHref} className="af-ml-btn">
            Import more
          </Link>
        </div>
      </footer>

      {/*
        ⚠ THE WITHHELD LIST IS PART OF THE SCREEN, NOT A DEV NOTE. The handoff's
        cards carry scores, win probability and records; this says plainly which
        of those are not wired, so a reader can tell "we have nothing to show" from
        "nothing is happening". Fed straight from the 34a coverage list so the two
        surfaces cannot disagree about what is missing.
      */}
      {coverage.length > 0 ? (
        <section className="af-ml-cover" aria-labelledby="af-ml-cover-h">
          <h2 className="af-ml-cover-h" id="af-ml-cover-h">
            Not yet watched
          </h2>
          <ul className="af-ml-cover-list">
            {coverage.map((c) => (
              <li key={c.label}>
                <strong>{c.label}</strong> — {c.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function LeagueCard({
  league,
  tier,
  view,
}: {
  league: MyLeaguesLeague
  tier: MyLeaguesTier
  view: ViewMode
}) {
  const chips = league.chips ?? []
  const tone = league.priority === 'urgent' ? 'bad' : league.reason ? 'warn' : null

  return (
    <article className="af-ml-card" data-tier={tier} data-tone={tone ?? undefined} data-view={view}>
      <div className="af-ml-card-top">
        <span className="af-ml-tile" data-platform={String(league.platform).toLowerCase()} aria-hidden>
          {initials(league.name)}
        </span>
        <div className="af-ml-card-id">
          <h3 className="af-ml-card-name" title={league.name}>
            {league.name}
          </h3>
          <p className="af-ml-card-meta">
            {platformLabel(String(league.platform))}
            {league.formatLabel ? ` · ${league.formatLabel}` : null}
          </p>
        </div>
        {league.isCommissioner ? <span className="af-ml-role">COMMISH</span> : null}
      </div>

      {/*
        The specific blocking cause, never a generic label. Quiet tiles carry
        nothing here on purpose — the handoff's third copy-contract line asks that
        leagues needing no attention stay undecorated.
      */}
      {tier !== 'quiet' ? (
        <div className="af-ml-card-body">
          {league.reason ? (
            <p className="af-ml-reason" data-tone={tone ?? undefined}>
              {league.reason}
            </p>
          ) : null}
          {chips.length > 0 ? (
            <div className="af-ml-card-chips">
              {chips.slice(0, 3).map((c) => (
                <span key={c.label} className="af-ml-tag" data-tone={c.tone ?? undefined}>
                  {c.label}
                </span>
              ))}
            </div>
          ) : null}
          {/*
            Where a score would go. `matchupNote` is the loader's honest stand-in
            ("No scores read yet" / "No roster imported yet"), not a placeholder
            number.
          */}
          {league.matchupNote ? <p className="af-ml-note">{league.matchupNote}</p> : null}
        </div>
      ) : null}

      <Link href={league.href} className="af-ml-open">
        {league.actionLabel ?? 'Open league'}
      </Link>
    </article>
  )
}

export default MyLeaguesV4
