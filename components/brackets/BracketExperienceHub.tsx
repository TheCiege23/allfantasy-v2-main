"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, CalendarClock, Check, Copy, Plus, Share2, Trophy, Users } from "lucide-react"
import type { PlayoffChallengeListItem, PlayoffChallengeView, PlayoffRoundKey, PlayoffSeriesView } from "@/lib/playoffs/types"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import { roundPointsTable } from "@/lib/playoffs/playoffScoring"
import { createPlayoffBracketEntryClient, getPlayoffBracketViewClient } from "@/lib/playoffs/playoffClientApi"
import { bracketExperienceCopy } from "@/lib/brackets/bracketExperienceCopy"
import { orderHubTournaments, type HubTournament } from "@/lib/brackets/hubTournaments"
import MlbBracketBoard from "./playoffs/MlbBracketBoard"
import BracketFunnel, { funnelFromSeries, nflFunnel } from "./BracketFunnel"
import "./bracket-experience.css"

type Sport = HubTournament
/** The tournaments the playoff engine can run a league for. NFL is a preview until it is one. */
type EngineSport = Exclude<Sport, "nfl">
type Tab = "bracket" | "standings" | "rules"
const createHref = (sport: EngineSport) => `/brackets/leagues/new?sport=${sport === "ncaaf" ? "NCAAF" : "NBA_CUP"}&challengeType=playoff_challenge`

export type HubTournamentProp = { tournament: Sport; live: boolean; season: number; opensAt: string }

/** Public SSR preview first; authenticated API reads progressively load the visitor's own league.
 * No useSession or browser-only state participates in the first render.
 *
 * ⚠ THE TAB ORDER AND THE OPENING TAB COME FROM `tournaments`, computed once on
 * the server (`orderHubTournaments`) and passed in, so the first client render
 * cannot disagree with the server's. The live tournament leads.
 */
export default function BracketExperienceHub({ language, season: seasonOverride, tournaments }: { language: string; season?: number; tournaments?: HubTournamentProp[] }) {
  const copy = bracketExperienceCopy(language)
  const [order] = useState<HubTournamentProp[]>(() => tournaments ?? orderHubTournaments().map((t) => ({ ...t, opensAt: t.opensAt.toISOString() })))
  const [sport, setSport] = useState<Sport>(order[0]?.tournament ?? "nba_cup")
  const current = order.find((t) => t.tournament === sport) ?? order[0]
  const season = seasonOverride ?? current?.season ?? new Date().getUTCFullYear()
  const engineSport: EngineSport | null = sport === "nfl" ? null : sport
  const [tab, setTab] = useState<Tab>("bracket")
  const [leagues, setLeagues] = useState<PlayoffChallengeListItem[]>([])
  const [view, setView] = useState<PlayoffChallengeView | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    const controller = new AbortController()
    setView(null); setLeagues([]); setError(null)
    // NFL has no pools yet, so there is nothing to load — only the preview.
    if (!engineSport) { setLoading(false); return () => { controller.abort(); generation.current++ } }
    setLoading(true)
    void (async () => {
      try {
        const response = await fetch(`/api/brackets/playoffs?sport=${engineSport}`, { cache: "no-store", signal: controller.signal })
        if (response.status === 401 || response.status === 403) return
        if (!response.ok) throw new Error(copy.loadError)
        const payload = await response.json()
        if (!Array.isArray(payload.challenges)) throw new Error(copy.loadError)
        const own = payload.challenges.filter((league: PlayoffChallengeListItem) => league.sport === engineSport && league.seasonYear === season)
        if (generation.current !== current) return
        setLeagues(own)
        if (own.length) {
          const next = await getPlayoffBracketViewClient(own[0].challengeId)
          if (generation.current === current) setView(next)
        }
      } catch {
        if (!controller.signal.aborted && generation.current === current) setError(copy.loadError)
      } finally {
        if (generation.current === current) setLoading(false)
      }
    })()
    return () => { controller.abort(); generation.current++ }
  }, [engineSport, season, retry, copy.loadError])

  useEffect(() => {
    if (!view) return
    let active = true
    const id = view.challenge.id, entryId = view.activeEntry?.id
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      void getPlayoffBracketViewClient(id, entryId).then((next) => { if (active) setView(next) }).catch(() => {})
    }, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [view?.challenge.id, view?.activeEntry?.id])

  async function selectLeague(id: string) {
    const current = ++generation.current
    setLoading(true); setError(null)
    try {
      const next = await getPlayoffBracketViewClient(id)
      if (generation.current === current) setView(next)
    } catch { if (generation.current === current) setError(copy.loadError) }
    finally { if (generation.current === current) setLoading(false) }
  }

  async function share(invite = false) {
    if (!view) return
    const path = !invite && view.activeEntry
      ? `/brackets/leagues/${view.challenge.id}/entries/${view.activeEntry.id}/view`
      : `/brackets/leagues/${view.challenge.id}`
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setNotice(copy.copied) }
    catch { setNotice(copy.copyFailed) }
  }

  async function createEntry() {
    if (!view || creating) return
    setCreating(true); setError(null)
    try {
      const result = await createPlayoffBracketEntryClient({ challengeId: view.challenge.id })
      window.location.assign(result.redirectUrl)
    } catch (failure) { setError(failure instanceof Error ? failure.message : copy.loadError); setCreating(false) }
  }

  const titleOf = (t: Sport) => t === "ncaaf" ? copy.cfp : t === "nba_cup" ? copy.cup : copy.nfl
  const title = titleOf(sport)
  const entry = view?.activeEntry
  const ranked = (view?.entries ?? []).filter((row) => row.finalizedAt).sort((a, b) => (a.rank ?? 999999) - (b.rank ?? 999999))
  const rows = engineSport ? buildPlayoffTemplate({ sport: engineSport, seasonYear: season }) : []
  const points = engineSport ? roundPointsTable(engineSport) : []
  const roundTitle = (round: PlayoffRoundKey) => round === "cup_group_play" ? copy.group : round === "cfp_first_round" ? copy.firstRound : /quarterfinals/.test(round) ? copy.quarters : /semifinals/.test(round) ? copy.semis : copy.championship
  const previewName = (name: string) => name.replace(/^CFP(\d+)$/, `${copy.team} $1`).replace(/^EAST(\d+)$/, `${copy.east} $1`).replace(/^WEST(\d+)$/, `${copy.west} $1`).replace(/^Winner S(\d+)$/, `${copy.winner} $1`).replace("East Champion", `${copy.east} · ${copy.winner}`).replace("West Champion", `${copy.west} · ${copy.winner}`)
  const entryHref = view && entry ? `/brackets/leagues/${view.challenge.id}/entries/${entry.id}` : null
  const boardHref = `/brackets/standings?sport=${sport}&season=${season}`
  const sideName = (conference: string | null) => conference === "east" ? copy.east : conference === "west" ? copy.west : conference === "upper" ? copy.upperBracket : conference === "lower" ? copy.lowerBracket : ""
  const funnel = engineSport
    ? funnelFromSeries(rows.filter((row) => row.round !== "cup_group_play").map((row) => ({ ...row, id: String(row.seriesNumber) })) as PlayoffSeriesView[], {
        name: previewName,
        roundTitle,
        points: (round) => points.find((item) => item.round === round)?.points ?? null,
        sideLabel: sideName,
      })
    : nflFunnel({ afc: copy.afc, nfc: copy.nfc, wildCard: copy.wildCard, divisional: copy.divisional, conference: copy.conferenceRound, superBowl: copy.superBowl, lowestSeed: copy.lowestSeed, winner: copy.winner, seed: copy.team, champion: copy.champion })
  const opensLabel = (t: HubTournamentProp) => `${copy.opens} ${new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(t.opensAt))}`
  const nflClosed = <span className="af-bx-btn af-bx-closed" role="note"><CalendarClock size={16} aria-hidden />{copy.nflSoon}</span>
  const standings = (limit?: number) => <>
    {(limit ? ranked.slice(0, limit) : ranked).map((row) => <div className="af-bx-leader" key={row.id}>
      <span className="af-bx-rank">{row.rank ?? "—"}</span><strong>{row.name}<small>{row.potentialTotal ?? 0} {copy.potential}</small></strong><span className="af-bx-points">{row.totalScore ?? 0}<small>{copy.earned}</small></span>
    </div>)}
    {!ranked.length ? <p className="af-bx-muted af-bx-empty">{copy.emptyBoard}</p> : null}
  </>

  return <div className="af-bx-shell">
    <section className="af-bx-hero" data-testid="brackets-hub-hero">
      <div><p className="af-bx-eyebrow">{copy.eyebrow}</p><h1>{copy.title}<br />{copy.titleEnd}</h1><p>{copy.subtitle}</p></div>
      <div className="af-bx-actions">
        <Link className="af-bx-btn" href="/brackets/my" data-testid="brackets-hub-my-brackets"><Trophy size={17} aria-hidden />{copy.myBrackets}</Link>
        {engineSport ? <Link className="af-bx-btn af-bx-primary" href={createHref(engineSport)}><Plus size={17} />{copy.create}</Link> : nflClosed}
        {view ? <button className="af-bx-btn" onClick={() => void share()}><Share2 size={16} />{copy.share}</button> : <Link className="af-bx-btn" href="/brackets/join"><Users size={16} />{copy.join}</Link>}
      </div>
    </section>
    <div className="af-bx-toolbar">
      <div className="af-bx-switch" role="group" aria-label={copy.tournament}>
        {order.map((t) => (
          <button
            type="button"
            key={t.tournament}
            aria-pressed={sport === t.tournament}
            onClick={() => { setSport(t.tournament); setTab("bracket") }}
            data-testid={t.tournament === "ncaaf" ? "brackets-hub-cta-cfp" : t.tournament === "nba_cup" ? "brackets-hub-cta-nba-cup" : "brackets-hub-cta-nfl"}
            data-live={t.live ? "true" : undefined}
            title={t.live ? copy.liveNow : opensLabel(t)}
          >
            {t.live ? <span className="af-bx-live-dot" aria-hidden="true" /> : null}{titleOf(t.tournament)}
          </button>
        ))}
      </div>
      <div className="af-bx-more"><span>{copy.next}</span><Link href="/brackets/leagues/new?sport=MLB&challengeType=playoff_challenge" data-testid="brackets-hub-cta-mlb">MLB <ArrowRight size={12} /></Link><Link href="/brackets/leagues/new?sport=NHL&challengeType=playoff_challenge" data-testid="brackets-hub-cta-nhl">NHL <ArrowRight size={12} /></Link></div>
    </div>
    <div className="af-bx-stats">
      <div className="af-bx-stat"><span>{copy.tournament}{current?.live ? <em className="af-bx-live-tag"><span className="af-bx-live-dot" aria-hidden="true" />{copy.liveNow}</em> : current ? <em className="af-bx-soon-tag">{opensLabel(current)}</em> : null}</span><strong>{title}</strong><small>{sport === "ncaaf" ? copy.cfpFormat : sport === "nba_cup" ? copy.cupFormat : copy.nflFormat}</small></div>
      <div className="af-bx-stat"><span>{copy.myBracket}</span><strong>{entry?.name || copy.startBracket}</strong><small>{entry ? `${entry.pickCount} ${copy.saved}` : copy.noBracket}</small></div>
      <div className="af-bx-stat"><span>{copy.position}</span><strong>{entry?.rank ? `#${entry.rank}` : copy.unranked}</strong><small>{ranked.length ? `${ranked.length} ${copy.competitors}` : copy.finalizeRank}</small></div>
      <div className="af-bx-stat"><span>{copy.lock}</span><strong>{sport === "nba_cup" ? copy.tipoff : sport === "nfl" ? copy.nflLock : copy.kickoff}</strong><small>{sport === "nba_cup" ? copy.cupLock : sport === "nfl" ? copy.nflLockNote : copy.cfpLock}</small></div>
    </div>
    {notice ? <p className="af-bx-notice" role="status"><Check size={16} />{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Close">×</button></p> : null}
    {error ? <p className="af-bx-notice af-bx-error" role="alert">{error}<button className="af-bx-btn" onClick={() => setRetry((value) => value + 1)}>{copy.retry}</button></p> : null}
    <div className="af-bx-layout">
      <section className="af-bx-panel af-bx-workspace" aria-label={title}>
        <header className="af-bx-panelhead"><div><h2>{entry?.name || title}</h2><p className="af-bx-muted">{view?.challenge.name || copy.pickWinner}</p></div><span className="af-bx-badge">{loading ? copy.loading : view ? String(season) : copy.preview}</span></header>
        <div className="af-bx-tabs" role="group" aria-label={title}>
          {(["bracket", "standings", "rules"] as const).map((item) => <button type="button" key={item} aria-pressed={tab === item} onClick={() => setTab(item)}>{copy[item]}</button>)}
        </div>
        {tab === "bracket" ? view && entry ? <MlbBracketBoard view={view} onViewChange={setView} actions={<Link className="af-pb-btn af-pb-btn--accent" href={entryHref!}>{copy.finalize} <ArrowRight size={14} /></Link>} /> : <>
          {view && !entry ? <div className="af-bx-detail"><button type="button" className="af-bx-btn af-bx-primary" disabled={creating} onClick={() => void createEntry()}>{creating ? copy.creating : copy.createEntry}</button></div> : null}
          {sport === "nba_cup" ? <div className="af-bx-group-note"><strong>{copy.group}</strong><p>{copy.groupNote}</p></div> : null}
          {funnel ? <BracketFunnel model={funnel} href={view ? `/brackets/leagues/${view.challenge.id}` : engineSport ? createHref(engineSport) : null} pointsLabel={copy.points} matchupLabel={copy.matchup} championLabel={copy.championship} /> : null}
          <p className="af-bx-boardfoot">{engineSport ? copy.previewNote : copy.nflSoon}</p>
        </> : tab === "standings" ? <div className="af-bx-detail">{standings()}<Link className="af-bx-btn" href={boardHref}>{copy.fullBoard} <ArrowRight size={14} /></Link></div> : <div className="af-bx-detail">
          <h3>{copy.rules}</h3><p>{sport === "nba_cup" ? copy.gameLock : sport === "nfl" ? copy.nflRule : copy.cfpRule}</p>
          {points.map((item) => <div className="af-bx-rule" key={item.round}><span>{roundTitle(item.round)}</span><strong>+{item.points} {copy.points}</strong></div>)}
          <div className="af-bx-rule"><span>{copy.zero}</span><strong>0 {copy.points}</strong></div><div className="af-bx-rule"><span>{copy.tiebreak}</span><strong>{copy.total}</strong></div>
        </div>}
      </section>
      <aside className="af-bx-side" id="bracket-leagues">
        <section className="af-bx-panel"><div className="af-bx-sidebody"><p className="af-bx-eyebrow">{copy.leagues}</p><h2>{view?.challenge.name || copy.crew}</h2>
          <p className="af-bx-muted">{view ? `${view.participants?.length ?? 0} ${copy.members} · ${view.entries.length} ${copy.brackets}` : copy.crewBody}</p>
          {leagues.length > 1 ? <label className="af-bx-select">{copy.selectLeague}<select value={view?.challenge.id ?? leagues[0].challengeId} onChange={(event) => void selectLeague(event.target.value)}>{leagues.map((league) => <option key={league.challengeId} value={league.challengeId}>{league.name}</option>)}</select></label> : null}
          {view ? <><div className="af-bx-invite"><code>{view.challenge.inviteCode}</code><button type="button" className="af-bx-icon-btn" onClick={() => void share(true)} aria-label={copy.invite}><Copy size={17} /></button></div><button type="button" className="af-bx-btn af-bx-primary af-bx-wide" onClick={() => void share(true)}>{copy.invite}</button><Link className="af-bx-text-link" href={`/brackets/leagues/${view.challenge.id}`}>{copy.leagueHome} <ArrowRight size={14} /></Link></> : <>{engineSport ? <Link className="af-bx-btn af-bx-primary af-bx-wide" href={createHref(engineSport)}><Users size={16} />{copy.create}</Link> : nflClosed}<Link className="af-bx-text-link" href="/brackets/join">{copy.join} <ArrowRight size={14} /></Link></>}
        </div></section>
        <section className="af-bx-panel"><header className="af-bx-panelhead"><h2><Trophy size={17} />{copy.leaderboard}</h2></header><div className="af-bx-sidebody">{standings(3)}<Link className="af-bx-btn af-bx-wide" href={boardHref}>{copy.fullBoard} <ArrowRight size={14} /></Link></div></section>
        <section className="af-bx-panel"><header className="af-bx-panelhead"><h2>{copy.leagueRules}</h2></header><div className="af-bx-sidebody"><div className="af-bx-rule"><span>{copy.limit}</span><strong>{copy.capacity}</strong></div><div className="af-bx-rule"><span>{copy.visibility}</span><strong>{copy.hidden}</strong></div><div className="af-bx-rule"><span>{copy.tiebreak}</span><strong>{copy.total}</strong></div></div></section>
      </aside>
    </div>
    <p className="af-bx-disclaimer">{copy.noPrizes}</p>
  </div>
}
