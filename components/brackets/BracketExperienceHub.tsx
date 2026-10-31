"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, Check, Copy, Plus, Share2, Trophy, Users } from "lucide-react"
import type { PlayoffChallengeListItem, PlayoffChallengeView, PlayoffRoundKey } from "@/lib/playoffs/types"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import { roundPointsTable } from "@/lib/playoffs/playoffScoring"
import { createPlayoffBracketEntryClient, getPlayoffBracketViewClient } from "@/lib/playoffs/playoffClientApi"
import { bracketExperienceCopy } from "@/lib/brackets/bracketExperienceCopy"
import MlbBracketBoard from "./playoffs/MlbBracketBoard"
import "./bracket-experience.css"

type Sport = "ncaaf" | "nba_cup"
type Tab = "bracket" | "standings" | "rules"
const createHref = (sport: Sport) => `/brackets/leagues/new?sport=${sport === "ncaaf" ? "NCAAF" : "NBA_CUP"}&challengeType=playoff_challenge`

/** Public SSR preview first; authenticated API reads progressively load the visitor's own league.
 * No useSession or browser-only state participates in the first render.
 */
export default function BracketExperienceHub({ language, season }: { language: string; season: number }) {
  const copy = bracketExperienceCopy(language)
  const [sport, setSport] = useState<Sport>("ncaaf")
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
    setLoading(true); setView(null); setLeagues([]); setError(null)
    void (async () => {
      try {
        const response = await fetch(`/api/brackets/playoffs?sport=${sport}`, { cache: "no-store", signal: controller.signal })
        if (response.status === 401 || response.status === 403) return
        if (!response.ok) throw new Error(copy.loadError)
        const payload = await response.json()
        if (!Array.isArray(payload.challenges)) throw new Error(copy.loadError)
        const own = payload.challenges.filter((league: PlayoffChallengeListItem) => league.sport === sport && league.seasonYear === season)
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
  }, [sport, season, retry, copy.loadError])

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

  const title = sport === "ncaaf" ? copy.cfp : copy.cup
  const entry = view?.activeEntry
  const ranked = (view?.entries ?? []).filter((row) => row.finalizedAt).sort((a, b) => (a.rank ?? 999999) - (b.rank ?? 999999))
  const rows = buildPlayoffTemplate({ sport, seasonYear: season })
  const points = roundPointsTable(sport)
  const roundTitle = (round: PlayoffRoundKey) => round === "cup_group_play" ? copy.group : round === "cfp_first_round" ? copy.firstRound : /quarterfinals/.test(round) ? copy.quarters : /semifinals/.test(round) ? copy.semis : copy.championship
  const previewName = (name: string) => name.replace(/^CFP(\d+)$/, `${copy.team} $1`).replace(/^EAST(\d+)$/, `${copy.east} $1`).replace(/^WEST(\d+)$/, `${copy.west} $1`).replace(/^Winner S(\d+)$/, `${copy.winner} $1`).replace("East Champion", `${copy.east} · ${copy.winner}`).replace("West Champion", `${copy.west} · ${copy.winner}`)
  const entryHref = view && entry ? `/brackets/leagues/${view.challenge.id}/entries/${entry.id}` : null
  const boardHref = `/brackets/standings?sport=${sport}&season=${season}`
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
        <Link className="af-bx-btn af-bx-primary" href={createHref(sport)}><Plus size={17} />{copy.create}</Link>
        {view ? <button className="af-bx-btn" onClick={() => void share()}><Share2 size={16} />{copy.share}</button> : <Link className="af-bx-btn" href="/brackets/join"><Users size={16} />{copy.join}</Link>}
      </div>
    </section>
    <div className="af-bx-toolbar">
      <div className="af-bx-switch" role="group" aria-label={copy.tournament}>
        <button type="button" aria-pressed={sport === "ncaaf"} onClick={() => { setSport("ncaaf"); setTab("bracket") }} data-testid="brackets-hub-cta-cfp">{copy.cfp}</button>
        <button type="button" aria-pressed={sport === "nba_cup"} onClick={() => { setSport("nba_cup"); setTab("bracket") }} data-testid="brackets-hub-cta-nba-cup">{copy.cup}</button>
      </div>
      <div className="af-bx-more"><span>{copy.next}</span><Link href="/brackets/leagues/new?sport=MLB&challengeType=playoff_challenge" data-testid="brackets-hub-cta-mlb">MLB <ArrowRight size={12} /></Link><Link href="/brackets/leagues/new?sport=NHL&challengeType=playoff_challenge" data-testid="brackets-hub-cta-nhl">NHL <ArrowRight size={12} /></Link></div>
    </div>
    <div className="af-bx-stats">
      <div className="af-bx-stat"><span>{copy.tournament}</span><strong>{title}</strong><small>{sport === "ncaaf" ? copy.cfpFormat : copy.cupFormat}</small></div>
      <div className="af-bx-stat"><span>{copy.myBracket}</span><strong>{entry?.name || copy.startBracket}</strong><small>{entry ? `${entry.pickCount} ${copy.saved}` : copy.noBracket}</small></div>
      <div className="af-bx-stat"><span>{copy.position}</span><strong>{entry?.rank ? `#${entry.rank}` : copy.unranked}</strong><small>{ranked.length ? `${ranked.length} ${copy.competitors}` : copy.finalizeRank}</small></div>
      <div className="af-bx-stat"><span>{copy.lock}</span><strong>{sport === "nba_cup" ? copy.tipoff : copy.kickoff}</strong><small>{sport === "nba_cup" ? copy.cupLock : copy.cfpLock}</small></div>
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
          <div className="af-bx-board"><div className="af-bx-rounds" style={{ gridTemplateColumns: `repeat(${sport === "ncaaf" ? 4 : 3}, minmax(185px, 1fr))` }}>
            {points.filter((item) => item.round !== "cup_group_play").map((item) => <section className="af-bx-round" key={item.round}>
              <h3>{roundTitle(item.round)}<span>+{item.points} {copy.points}</span></h3>
              {rows.filter((row) => row.round === item.round).map((game, index) => <Link href={view ? `/brackets/leagues/${view.challenge.id}` : createHref(sport)} className="af-bx-game" key={game.seriesNumber} aria-label={`${copy.createEntry}: ${previewName(game.homeTeamName)} / ${previewName(game.awayTeamName)}`}>
                <header><span>{copy.matchup} {index + 1}</span><span>{copy.awaiting}</span></header>
                {[{ name: game.homeTeamName, seed: game.homeSeed }, { name: game.awayTeamName, seed: game.awaySeed }].map((team, side) => <div className="af-bx-team" key={side}><span>{team.seed || "·"}</span><strong>{previewName(team.name)}</strong><Plus size={13} /></div>)}
              </Link>)}
            </section>)}
          </div></div><p className="af-bx-boardfoot">{copy.previewNote}</p>
        </> : tab === "standings" ? <div className="af-bx-detail">{standings()}<Link className="af-bx-btn" href={boardHref}>{copy.fullBoard} <ArrowRight size={14} /></Link></div> : <div className="af-bx-detail">
          <h3>{copy.rules}</h3><p>{sport === "nba_cup" ? copy.gameLock : copy.cfpRule}</p>
          {points.map((item) => <div className="af-bx-rule" key={item.round}><span>{roundTitle(item.round)}</span><strong>+{item.points} {copy.points}</strong></div>)}
          <div className="af-bx-rule"><span>{copy.zero}</span><strong>0 {copy.points}</strong></div><div className="af-bx-rule"><span>{copy.tiebreak}</span><strong>{copy.total}</strong></div>
        </div>}
      </section>
      <aside className="af-bx-side" id="bracket-leagues">
        <section className="af-bx-panel"><div className="af-bx-sidebody"><p className="af-bx-eyebrow">{copy.leagues}</p><h2>{view?.challenge.name || copy.crew}</h2>
          <p className="af-bx-muted">{view ? `${view.participants?.length ?? 0} ${copy.members} · ${view.entries.length} ${copy.brackets}` : copy.crewBody}</p>
          {leagues.length > 1 ? <label className="af-bx-select">{copy.selectLeague}<select value={view?.challenge.id ?? leagues[0].challengeId} onChange={(event) => void selectLeague(event.target.value)}>{leagues.map((league) => <option key={league.challengeId} value={league.challengeId}>{league.name}</option>)}</select></label> : null}
          {view ? <><div className="af-bx-invite"><code>{view.challenge.inviteCode}</code><button type="button" className="af-bx-icon-btn" onClick={() => void share(true)} aria-label={copy.invite}><Copy size={17} /></button></div><button type="button" className="af-bx-btn af-bx-primary af-bx-wide" onClick={() => void share(true)}>{copy.invite}</button><Link className="af-bx-text-link" href={`/brackets/leagues/${view.challenge.id}`}>{copy.leagueHome} <ArrowRight size={14} /></Link></> : <><Link className="af-bx-btn af-bx-primary af-bx-wide" href={createHref(sport)}><Users size={16} />{copy.create}</Link><Link className="af-bx-text-link" href="/brackets/join">{copy.join} <ArrowRight size={14} /></Link></>}
        </div></section>
        <section className="af-bx-panel"><header className="af-bx-panelhead"><h2><Trophy size={17} />{copy.leaderboard}</h2></header><div className="af-bx-sidebody">{standings(3)}<Link className="af-bx-btn af-bx-wide" href={boardHref}>{copy.fullBoard} <ArrowRight size={14} /></Link></div></section>
        <section className="af-bx-panel"><header className="af-bx-panelhead"><h2>{copy.leagueRules}</h2></header><div className="af-bx-sidebody"><div className="af-bx-rule"><span>{copy.limit}</span><strong>{copy.capacity}</strong></div><div className="af-bx-rule"><span>{copy.visibility}</span><strong>{copy.hidden}</strong></div><div className="af-bx-rule"><span>{copy.tiebreak}</span><strong>{copy.total}</strong></div></div></section>
      </aside>
    </div>
    <p className="af-bx-disclaimer">{copy.noPrizes}</p>
  </div>
}
