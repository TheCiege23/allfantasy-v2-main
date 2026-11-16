'use client'

import Link from 'next/link'
import { leagueEntryHref } from '@/lib/league/leagueEntryHref'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { coreWidgetsMessages } from '@/lib/core-app/messages/coreWidgets'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { groupLeagueHubs } from '@/lib/core-app/leagueHubGroups'
import { leagueSportCounts, leagueSportKey, leagueSportLabel } from '@/lib/core-app/leagueSports'
import { hasLeagueSortMetric, isLeagueSortMode, LEAGUE_SORT_OPTIONS, LEAGUE_SORT_STORAGE_KEY, sortLeagues, type LeagueSortMode } from '@/lib/league-list/sortLeagues'
import type { MyLeaguesData, MyLeaguesLeague, MyLeaguesTier } from '@/lib/core-app/myLeagues'
import { LeagueHistoryVirtualList } from './LeagueHistoryVirtualList'
import { PageHeader } from '@/components/core-app/primitives/PageHeader'
// af-core.css carries the .af-core token layer (--surface, --line, --chip, --accent,
// the --p-* platform pairs …) that every rule in af-my-leagues.css reads. This screen
// now renders at /core/leagues inside AfCoreShell (/leagues redirects there), which
// already carries both — but keep the import and the `af-core` root class: the
// af-my-leagues-redesign.css rules are scoped `.af-core.af-ml`, and /dev/leagues-preview
// still renders the screen without the shell.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-my-leagues.css'
// The My Leagues board restyle (2026-11-05): layered on top so the screen's own rules stay the base.
import '@/components/core-app/af-my-leagues-redesign.css'
// The plain-words guide (2026-11-14): the headline, the honest groups and the folds.
import '@/components/core-app/af-my-leagues-guide.css'
import { myLeaguesGuideMessages } from '@/lib/core-app/messages/myLeaguesGuide'
import { extraChips, myLeaguesHeadline, parseReason, type GuideReason } from '@/lib/core-app/myLeaguesGuide'

/**
 * Screen 21a — "My Leagues, at 61 live".
 *
 * The server's urgency order remains the default. Explicit sort choices show one
 * ordered list across all urgency tiers, so a sport or name sort is truly global.
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
  /**
   * Leagues the account hid from its lists (lib/core-app/leaguePreferences.ts). They leave the tiers
   * and collect in a collapsed "Hidden leagues" section; a search still finds them in place.
   */
  hiddenIds?: string[]
  /** Where the "Import more" actions go. */
  importHref: string
  /** The add-league / re-sync surface this screen replaced at /leagues. */
  /** Optional: the account-wide sync page is retired, so callers may omit it. */
  syncHref?: string | null
}

type ChipKey = 'needs' | 'playing' | 'commissioner' | 'drafting' | 'dynasty' | 'quiet'
type ViewMode = 'grid' | 'list'

/** Each group's anchor. Titles and blurbs live in myLeaguesGuideMessages, in both languages. */
const TIER_ANCHOR: Record<MyLeaguesTier, string> = {
  needs: 'af-ml-needs',
  /*
   * ⚠ THE HANDOFF CALLS THIS TIER "PLAYING NOW" AND PUTS A LIVE SCORE ON IT.
   * "In season" is the claim this data actually supports.
   */
  playing: 'af-ml-playing',
  predraft: 'af-ml-predraft',
  quiet: 'af-ml-quiet',
}

/** Grid caps per tier, mirroring the handoff's 3-up / 4-up / 6-up density. */
const TIER_CAP: Record<MyLeaguesTier, number> = { needs: 6, playing: 8, predraft: 8, quiet: 12 }

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
  hiddenIds = [],
}: MyLeaguesV4Props) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const g = useMessages(myLeaguesGuideMessages)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState<string>('all')
  /** `undefined` = all sports; `null` = the leagues with no sport recorded ("Other"). */
  const [sport, setSport] = useState<string | null | undefined>(undefined)
  const [showHistory, setShowHistory] = useState(false)
  const [view, setView] = useState<ViewMode>('grid')
  const [sortMode, setSortMode] = useState<LeagueSortMode>('default')
  const [chip, setChip] = useState<ChipKey | null>(null)
  const [expanded, setExpanded] = useState<Partial<Record<MyLeaguesTier, boolean>>>({})

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LEAGUE_SORT_STORAGE_KEY)
      if (isLeagueSortMode(saved)) setSortMode(saved)
    } catch {}
  }, [])

  const changeSort = (mode: LeagueSortMode) => {
    setSortMode(mode)
    try { window.localStorage.setItem(LEAGUE_SORT_STORAGE_KEY, mode) } catch {}
  }

  const effectiveSort = hasLeagueSortMetric(leagues, sortMode) ? sortMode : 'default'

  const q = query.trim().toLowerCase()
  const hiddenKey = hiddenIds.join('.')
  const hiddenSet = useMemo(() => new Set(hiddenKey ? hiddenKey.split('.') : []), [hiddenKey])
  // Out of the tiers unless the reader is searching — then a hidden league is found where it lives.
  const hiddenLeagues = useMemo(() => (q ? [] : leagues.filter((l) => hiddenSet.has(l.id))), [leagues, hiddenSet, q])

  const filtered = useMemo(() => {
    return leagues.filter((l) => {
      if (!q && hiddenSet.has(l.id)) return false
      if (platform !== 'all' && String(l.platform).toLowerCase() !== platform) return false
      if (sport !== undefined && leagueSportKey(l.sport) !== sport) return false
      if (q && ![l.name, l.hub?.name, ...(l.hub?.members.map((m) => m.name) ?? [])].filter(Boolean).join(' ').toLowerCase().includes(q)) return false
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
  }, [leagues, platform, sport, q, chip, hiddenSet])
  const sortedFiltered = useMemo(() => sortLeagues(filtered, effectiveSort), [filtered, effectiveSort])

  /*
   * Sport tabs. Counted over every live league the account holds (hidden ones included, as the
   * chip counts are), so a tab's number does not move as other filters change. Shown only when
   * the account plays two or more sports: a single "NFL 12" tab separates nothing.
   */
  const sportTabs = useMemo(() => leagueSportCounts(leagues), [leagues])

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

  const tiers: MyLeaguesTier[] = ['needs', 'playing', 'predraft', 'quiet']
  /*
   * Each Exile Island rides under its Survivor league, in that league's tier, joined by ↕ — it is
   * part of that game, not a league of its own. An island whose league is filtered out keeps its
   * own place.
   */
  const { byTier, islandsOf } = useMemo(() => {
    const present = new Set(filtered.map((l) => l.id))
    const islandsOf = new Map<string, MyLeaguesLeague[]>()
    for (const l of filtered) {
      if (!l.exileOf || l.exileOf === l.id || !present.has(l.exileOf)) continue
      islandsOf.set(l.exileOf, [...(islandsOf.get(l.exileOf) ?? []), l])
    }
    const paired = new Set([...islandsOf.values()].flat().map((l) => l.id))
    const map: Record<MyLeaguesTier, MyLeaguesLeague[]> = { needs: [], playing: [], predraft: [], quiet: [] }
    for (const l of groupLeagueHubs(filtered.filter((row) => !paired.has(row.id)))) map[l.tier].push(l)
    return { byTier: map, islandsOf }
  }, [filtered])
  const sortedCards = useMemo(() => {
    const paired = new Set([...islandsOf.values()].flat().map((league) => league.id))
    return groupLeagueHubs(sortedFiltered.filter((league) => !paired.has(league.id)))
  }, [sortedFiltered, islandsOf])

  const nothingMatches = filtered.length === 0 && filteredHistory.length === 0

  /*
   * The answer to "which of my leagues needs me right now?", read from every live league (hidden ones
   * too, as the counts are). See myLeaguesGuide.ts for why "Needs you" no longer means "any warning".
   */
  const head = useMemo(() => myLeaguesHeadline(leagues), [leagues])
  const headline =
    head.lead === 'fix' ? g.headFix(head.fix)
      : head.lead === 'questionable' ? g.headQuestionable(head.questionable)
        : head.lead === 'drafting' ? g.headDrafting(head.drafting)
          : head.lead === 'empty' ? g.headEmpty
            : g.headClear
  const headChips = [
    head.lead === 'fix' && head.questionable > 0 ? { key: 'questionable', text: g.chipQuestionable(head.questionable), href: '#af-ml-needs' } : null,
    head.lead !== 'drafting' && head.drafting > 0 ? { key: 'drafting', text: g.chipDrafting(head.drafting), href: '#af-ml-needs' } : null,
    head.predraft > 0 ? { key: 'predraft', text: g.chipPredraft(head.predraft), href: '#af-ml-predraft' } : null,
  ].filter((c): c is { key: string; text: string; href: string } => c !== null)
  const why =
    head.lead === 'fix' ? g.whyFix
      : head.lead === 'questionable' ? g.whyQuestionable
        : head.lead === 'drafting' ? g.whyDrafting
          : head.lead === 'clear' ? g.whyClear
            : null
  const filtersOn = [platform !== 'all', effectiveSort !== 'default', showHistory, view !== 'grid', chip !== null].filter(Boolean).length

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
      <PageHeader
        className="af-ml-head af-mlg-head"
        headlineClassName="af-ml-headline"
        titleClassName="af-ml-title af-mlg-title"
        subClassName="af-ml-sub af-mlg-sub"
        actionsClassName="af-ml-actions"
        eyebrowTestId="my-leagues-eyebrow"
        testId="my-leagues-guide"
        /* The page's name and the one count of live leagues, said once. */
        eyebrow={g.eyebrow(counts.live)}
        title={headline}
        sub={
          <>
            <span className="af-mlg-intro">{counts.live === 0 ? g.introEmpty : g.intro}</span>
            {headChips.length > 0 ? (
              <span className="af-mlg-chips">
                {headChips.map((c) => (
                  <a key={c.key} className="af-mlg-chip" data-chip={c.key} href={c.href}>
                    {c.text}
                  </a>
                ))}
              </span>
            ) : null}
            {why ? <span className="af-mlg-why" data-testid="my-leagues-why">{why}</span> : null}
          </>
        }
        actions={
          <>
            <Link href="/create-league" className="af-ml-btn af-ml-btn--ghost">
              {g.createLeague}
            </Link>
            <Link href={importHref} className="af-ml-btn">
              {g.importLeague}
            </Link>
          </>
        }
      />

      {/* ── Search and sport stay in view; everything else folds ─────────── */}
      <div className="af-ml-controls af-mlg-controls">
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
            aria-label={copy('Search leagues')}
            className="af-ml-search-input"
          />
        </label>
      </div>

      {sportTabs.length > 1 ? (
        <div className="af-ml-chips af-ml-sports" role="group" aria-label={copy('Filter by sport')}>
          <button
            type="button"
            className="af-ml-chip"
            data-on={sport === undefined}
            onClick={() => setSport(undefined)}
            aria-pressed={sport === undefined}
          >
            {copy('All sports')}
          </button>
          {sportTabs.map((s) => (
            <button
              key={s.key ?? 'other'}
              type="button"
              className="af-ml-chip"
              data-on={sport === s.key}
              onClick={() => setSport((cur) => (cur === s.key ? undefined : s.key))}
              aria-pressed={sport === s.key}
            >
              {leagueSportLabel(s.key)} <span className="af-ml-chip-n af-num">{s.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <details className="af-mlg-filters" data-testid="my-leagues-filters">
        <summary>
          {g.filterMore}
          {filtersOn > 0 ? <span className="af-mlg-on af-num">{filtersOn}</span> : null}
        </summary>
        <div className="af-mlg-filters-body">
          <div className="af-ml-controls">
          <label className="af-ml-select">
            <span className="af-ml-select-label">{copy('Platform')}</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              aria-label="Filter by platform"
            >
              <option value="all">{copy('All platforms')}</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="af-ml-select">
            <span className="af-ml-select-label">{copy('Sort')}</span>
            <select
              value={effectiveSort}
              onChange={(event) => changeSort(event.target.value as LeagueSortMode)}
              aria-label={copy('Sort leagues')}
            >
              {LEAGUE_SORT_OPTIONS.map((option) => {
                const available = hasLeagueSortMetric(leagues, option.value)
                return (
                  <option key={option.value} value={option.value} disabled={!available}>
                    {copy(option.value === 'default' ? 'Needs you first' : option.label)}
                    {available ? '' : ` (${copy('data unavailable')})`}
                  </option>
                )
              })}
            </select>
          </label>
          <button
            type="button"
            className="af-ml-toggle"
            data-on={showHistory}
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
          >
            {copy(showHistory ? 'Live + history' : '+ history')}
          </button>
          <div className="af-ml-view" role="group" aria-label={copy('View mode')}>
            <button
              type="button"
              className="af-ml-view-btn"
              data-on={view === 'grid'}
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
            >
              {copy('Grid')}
            </button>
            <button
              type="button"
              className="af-ml-view-btn"
              data-on={view === 'list'}
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
            >
              {copy('List')}
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
                {copy(c.label)} <span className="af-ml-chip-n af-num">{c.count}</span>
              </button>
            ))}
            {chip ? (
              <button type="button" className="af-ml-chip af-ml-chip--clear" onClick={() => setChip(null)}>
                {copy('Clear filter')}
              </button>
            ) : null}
          </div>
          <div className="af-mlg-links">
            <Link href="/brackets/my" className="af-ml-btn af-ml-btn--ghost">
              {language?.startsWith('es') ? 'Mis cuadros' : 'My brackets'}
            </Link>
            {/*
              ⚠ ONLY WHEN THERE IS SOMEWHERE TO GO. /leagues/sync is retired, so
              this renders nothing rather than pointing at /import beside a button
              that already says "Import a league".
            */}
            {syncHref ? (
              <Link href={syncHref} className="af-ml-btn af-ml-btn--ghost">
                {copy('Sync & connect')}
              </Link>
            ) : null}
            {/*
              ⚠ OUTSIDE THE `syncHref` CONDITIONAL, deliberately: pairing two
              already-imported leagues has nothing to do with whether a sync
              destination exists.
            */}
            <Link href="/core/connect-leagues" className="af-ml-btn af-ml-btn--ghost">
              {copy('Connect two leagues')}
            </Link>
          </div>
        </div>
      </details>

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
          <p className="af-ml-empty-t">{copy('Nothing matches those filters')}</p>
          <p className="af-ml-empty-p">
            {counts.live === 0
              ? 'No leagues are connected to this account yet.'
              : 'Try a different platform, clear the chip filter, or turn on “+ history” to search past seasons.'}
          </p>
          <div className="af-ml-empty-actions">
            <Link href="/create-league" className="af-ml-btn">
              Create a league
            </Link>
            {counts.live === 0 ? (
              <Link href={importHref} className="af-ml-btn">
                {copy('Import a league')}
              </Link>
            ) : (
              <button
                type="button"
                className="af-ml-btn af-ml-btn--ghost"
                onClick={() => {
                  setQuery('')
                  setPlatform('all')
                  setSport(undefined)
                  setChip(null)
                }}
              >
                {copy('Reset filters')}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {effectiveSort !== 'default' && sortedCards.length > 0 ? (
        <section className="af-ml-tier" id="af-ml-sorted" data-tier="quiet">
          <div className="af-ml-tier-head">
            <h2 className="af-ml-tier-title">
              {copy('All leagues')} <span className="af-ml-tier-n af-num">{filtered.length}</span>
            </h2>
          </div>
          <div className="af-ml-grid" data-tier="quiet" data-view={view}>
            {sortedCards.map((league) => {
              const islands = islandsOf.get(league.id)
              if (!islands) return <LeagueCard key={league.id} league={league} tier={league.tier} view={view} />
              return (
                <div key={league.id} className="af-ml-exile-pair">
                  <LeagueCard league={league} tier={league.tier} view={view} />
                  {islands.map((island) => (
                    <Fragment key={island.id}>
                      <div className="af-ml-exile-link" title={`${copy('Exile Island for')} ${league.name}`} aria-hidden>↕</div>
                      <LeagueCard league={island} tier={island.tier} view={view} exile />
                    </Fragment>
                  ))}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* ── The three urgency tiers remain the default view ─────────────── */}
      {effectiveSort === 'default' ? tiers.map((tier) => {
        const all = byTier[tier]
        if (all.length === 0) return null
        const cap = TIER_CAP[tier]
        const isOpen = expanded[tier] === true
        const shown = isOpen ? all : all.slice(0, cap)
        const rest = all.length - shown.length
        const title = tier === 'needs' ? g.needsTitle : tier === 'playing' ? g.playingTitle : tier === 'predraft' ? g.predraftTitle : g.quietTitle
        const blurb = tier === 'needs' ? g.needsBlurb : tier === 'playing' ? g.playingBlurb : tier === 'predraft' ? g.predraftBlurb : g.quietBlurb

        return (
          <section key={tier} className="af-ml-tier" id={TIER_ANCHOR[tier]} data-tier={tier}>
            <div className="af-ml-tier-head">
              <h2 className="af-ml-tier-title">
                {title} <span className="af-ml-tier-n af-num">{all.reduce((n, l) => n + 1 + (islandsOf.get(l.id)?.length ?? 0), 0)}</span>
              </h2>
              <p className="af-ml-tier-blurb">{blurb}</p>
            </div>

            <div className="af-ml-grid" data-tier={tier} data-view={view}>
              {shown.map((l) => {
                const islands = islandsOf.get(l.id)
                if (!islands) return <LeagueCard key={l.id} league={l} tier={tier} view={view} />
                return (
                  <div key={l.id} className="af-ml-exile-pair" data-testid="leagues-exile-pair">
                    <LeagueCard league={l} tier={tier} view={view} />
                    {islands.map((island) => (
                      <Fragment key={island.id}>
                        <div className="af-ml-exile-link" title={`${copy('Exile Island for')} ${l.name}`} aria-hidden>↕</div>
                        <LeagueCard league={island} tier={tier} view={view} exile />
                      </Fragment>
                    ))}
                  </div>
                )
              })}

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
                  <span className="af-ml-more-l">{g.moreIn(rest, tier)}</span>
                </button>
              ) : null}
            </div>

            {isOpen && all.length > cap ? (
              <button
                type="button"
                className="af-ml-collapse"
                onClick={() => setExpanded((e) => ({ ...e, [tier]: false }))}
              >
                {copy('Show fewer')}
              </button>
            ) : null}
          </section>
        )
      }) : null}

      {/* ── Hidden ─────────────────────────────────────────────────────────── */}
      {hiddenLeagues.length > 0 ? (
        <details className="af-ml-tier" id="af-ml-hidden" data-testid="my-leagues-hidden">
          <summary className="af-ml-tier-head">
            <h2 className="af-ml-tier-title">
              {copy('Hidden leagues')} <span className="af-ml-tier-n af-num">{hiddenLeagues.length}</span>
            </h2>
            <p className="af-ml-tier-blurb">
              Hidden from your lists, still counted in your totals.{' '}
              <Link href="/settings?tab=preferences&returnTo=%2Fleagues">Manage in Settings</Link>
            </p>
          </summary>
          <div className="af-ml-grid" data-tier="quiet" data-view={view}>
            {sortLeagues(hiddenLeagues, effectiveSort).map((l) => (
              <LeagueCard key={l.id} league={l} tier={l.tier} view={view} />
            ))}
          </div>
        </details>
      ) : null}

      {/* ── History ──────────────────────────────────────────────────────── */}
      {showHistory && filteredHistory.length > 0 ? (
        <section className="af-ml-tier" id="af-ml-history">
          <div className="af-ml-tier-head">
            <h2 className="af-ml-tier-title">
              {copy('Past seasons')} <span className="af-ml-tier-n af-num">{filteredHistory.length}</span>
            </h2>
            <p className="af-ml-tier-blurb">
              Finished seasons from your career import. These are records, not leagues you play —
              they live in Career &amp; Legacy.
            </p>
          </div>
          <LeagueHistoryVirtualList rows={filteredHistory} />
        </section>
      ) : null}

      {/*
        ── Past seasons and what we can't see yet, folded at the foot ──────────
        ⚠ THE WITHHELD LIST STAYS PART OF THE SCREEN, NOT A DEV NOTE: it says
        plainly which things are not wired, so a reader can tell "we have nothing
        to show" from "nothing is happening". It is reference, so it folds.
      */}
      <details className="af-mlg-foot" data-testid="my-leagues-foot">
        <summary>{g.footSummary(counts.history)}</summary>
        <div className="af-mlg-foot-body">
          <p className="af-ml-foot-p">{counts.history > 0 ? g.footHistory : g.footNoHistory}</p>
          <div className="af-ml-foot-actions">
            <Link href="/core/career" className="af-ml-btn af-ml-btn--ghost">
              {copy('Browse history')}
            </Link>
            <Link href={importHref} className="af-ml-btn af-ml-btn--ghost">
              {copy('Import more')}
            </Link>
          </div>
          {coverage.length > 0 ? (
            <section className="af-ml-cover" aria-labelledby="af-ml-cover-h">
              <h2 className="af-ml-cover-h" id="af-ml-cover-h">
                {g.notWatched}
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
      </details>
    </div>
  )
}

function LeagueCard({
  league,
  tier,
  view,
  exile = false,
}: {
  league: MyLeaguesLeague
  tier: MyLeaguesTier
  view: ViewMode
  /** An Exile Island drawn under its Survivor league: named "Exile Island", full name in the title. */
  exile?: boolean
}) {
  const m = useMessages(coreWidgetsMessages)
  const g = useMessages(myLeaguesGuideMessages)
  const { language } = useOptionalLanguage()
  // The reason line says it once; the COMMISH badge says the other — neither repeats as a chip.
  const chips = extraChips(league.chips, league.reason)
  // Only a league in "Needs you" is tinted; a hurt bench player is a note, not a warning.
  const tone = league.priority === 'urgent' ? 'bad' : league.reason && tier === 'needs' ? 'warn' : null
  const reason = reasonText(parseReason(league.reason), g)
  const matchupLine = league.matchup ? matchupText(league.matchup, g) : league.matchupNote ?? null
  const dashboardLabel = league.actionLabel === 'See who is flagged'
    ? g.seeWhoIsHurt
    : league.actionLabel && league.actionLabel !== 'Open league'
      ? league.actionLabel
      : m.myLeaguesDashboard

  return (
    <article className="af-ml-card" data-tier={tier} data-tone={tone ?? undefined} data-view={view} data-exile={exile ? 'true' : undefined}>
      <div className="af-ml-card-top">
        <span className="af-ml-tile" data-platform={String(league.platform).toLowerCase()} aria-hidden>
          {initials(league.name)}
        </span>
        <div className="af-ml-card-id">
          <h3 className="af-ml-card-name" title={league.name}>
            {exile ? coreUiCopy('Exile Island', language) : league.hub?.name ?? league.name}
          </h3>
          <p className="af-ml-card-meta">
            <span className="af-ml-sport">{leagueSportLabel(leagueSportKey(league.sport), { short: true })}</span>
            {' · '}
            {league.hub ?`${league.hub.members.length} connected leagues · shared hub` : platformLabel(String(league.platform))}
            {league.formatLabel ? ` · ${league.formatLabel}` : null}
          </p>
        </div>
        {league.audience ? (
          <span className="af-ml-audience" data-audience={league.audience} data-testid="ml-league-audience">
            {coreUiCopy(league.audience === 'public' ? 'PUBLIC' : 'PRIVATE', language)}
          </span>
        ) : null}
        {league.isCommissioner ? <span className="af-ml-role">COMMISH</span> : null}
      </div>

      {league.hub ? <div className="af-ml-hub-members">{league.hub.members.map((member) => <Link key={member.id} href={member.href}><span>{member.name}</span><small>{platformLabel(member.platform)} ↗</small></Link>)}</div> : null}
      {/*
        The specific blocking cause, never a generic label. Quiet tiles carry
        nothing here on purpose — the handoff's third copy-contract line asks that
        leagues needing no attention stay undecorated.
      */}
      {tier !== 'quiet' ? (
        <div className="af-ml-card-body">
          {reason ? (
            <p className="af-ml-reason" data-tone={tone ?? undefined}>
              {reason}
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
          {matchupLine && tier !== 'predraft' ? <p className="af-ml-note">{matchupLine}</p> : null}
        </div>
      ) : null}

      <div className="af-ml-card-actions">
        <Link href={league.hub?.href ?? (isNativePlatform(league.platform) ? leagueEntryHref(league) : league.href)} className="af-ml-open">
          {league.hub ? m.myLeaguesOpenHub : isNativePlatform(league.platform) ? m.myLeaguesOpenLeague : dashboardLabel}
        </Link>
      </div>
    </article>
  )
}

type GuideCopy = (typeof myLeaguesGuideMessages)['en']

/** A card's reason in plain words — "1 starter questionable", not "1 STARTER FLAGGED". */
function reasonText(r: GuideReason | null, g: GuideCopy): string | null {
  if (!r) return null
  switch (r.key) {
    case 'startersOut': return g.startersOut(r.n)
    case 'startersQuestionable': return g.startersQuestionable(r.n)
    case 'playersHurt': return g.playersHurt(r.n)
    case 'drafting': return g.drafting
    case 'preDraft': return g.preDraft
    case 'lineupUnchecked': return g.lineupUnchecked
    case 'bestBallGap': return g.bestBallGap
    default: return r.label
  }
}

/** "Week 10 · 20.3–18.1 vs Wounded Warriors", "Week 10 vs Hustead", or "Week 10 · 0.0 points" with no pairing. */
function matchupText(mu: NonNullable<MyLeaguesLeague['matchup']>, g: GuideCopy): string {
  if (mu.unpaired) return mu.scored ? g.weekPoints(mu.week, mu.yourScore.toFixed(1)) : g.weekOnly(mu.week)
  const opponent = mu.opponent?.trim() || '—'
  return mu.scored
    ? g.weekScore(mu.week, mu.yourScore.toFixed(1), mu.opponentScore.toFixed(1), opponent)
    : g.weekVs(mu.week, opponent)
}

export default MyLeaguesV4
