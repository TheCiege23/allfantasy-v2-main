"use client"
import Link from "next/link"
import { useEffect, useState, type CSSProperties } from "react"
import type { CfpProjection } from "@/lib/playoffs/cfpRankingsProjection"
import type { CfpBowlCrestKey } from "@/lib/playoffs/cfpBowlCrest"
import CfpBowlCrest from "./CfpBowlCrest"
import CfpBowlSchedule from "./CfpBowlSchedule"
import "./cfp-preview.css"

// Snapshot of the first committee ranking, not the final playoff field.
// Boise State is projected into the Group of Six automatic-qualifier spot.
const fallbackTeams = ["Miami", "Georgia", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Boise State"] as const

/*
 * Which quarterfinal plays in which bowl is the committee's call on selection day.
 * Until then these pairings are illustrative, and the footnote below says so.
 * Crests are our own artwork (lib/playoffs/cfpBowlCrest.ts), never the bowls' marks.
 */
type Bowl = { key: CfpBowlCrestKey; name: string; date: string }
const BOWL = {
  rose: { key: "rose", name: "Rose Bowl", date: "Jan 1" },
  fiesta: { key: "fiesta", name: "Fiesta Bowl", date: "Dec 30" },
  peach: { key: "peach", name: "Peach Bowl", date: "Jan 1" },
  cotton: { key: "cotton", name: "Cotton Bowl", date: "Jan 1" },
  orange: { key: "orange", name: "Orange Bowl", date: "Jan 14" },
  sugar: { key: "sugar", name: "Sugar Bowl", date: "Jan 15" },
  title: { key: "title", name: "National Championship", date: "Jan 25" },
} satisfies Record<string, Bowl>

/** One team's place in the bracket: a seeded team, or the winner of an earlier game. */
type Slot = { seed?: number; from?: string }
type Game = { a: Slot; b: Slot; bowl?: Bowl }

const ROUNDS: Array<{ title: string; when: string; games: Game[] }> = [
  { title: "First round", when: "Dec 18–19 · campus sites", games: [
    { a: { seed: 9 }, b: { seed: 8 } }, { a: { seed: 12 }, b: { seed: 5 } },
    { a: { seed: 10 }, b: { seed: 7 } }, { a: { seed: 11 }, b: { seed: 6 } },
  ] },
  { title: "Quarterfinals", when: "Dec 30 – Jan 1", games: [
    { a: { from: "Winner 8 / 9" }, b: { seed: 1 }, bowl: BOWL.rose },
    { a: { seed: 4 }, b: { from: "Winner 5 / 12" }, bowl: BOWL.fiesta },
    { a: { from: "Winner 7 / 10" }, b: { seed: 2 }, bowl: BOWL.peach },
    { a: { seed: 3 }, b: { from: "Winner 6 / 11" }, bowl: BOWL.cotton },
  ] },
  { title: "Semifinals", when: "Jan 14–15", games: [
    { a: { from: "Rose Bowl winner" }, b: { from: "Fiesta Bowl winner" }, bowl: BOWL.orange },
    { a: { from: "Peach Bowl winner" }, b: { from: "Cotton Bowl winner" }, bowl: BOWL.sugar },
  ] },
  { title: "Championship", when: "Jan 25", games: [
    { a: { from: "Orange Bowl winner" }, b: { from: "Sugar Bowl winner" }, bowl: BOWL.title },
  ] },
]

/*
 * The broadcast layout (wide screens): first round on the outside edges, then the
 * quarterfinals and semifinals working inward, the two finalists side by side and
 * the champion below. Drawn on a 1232 × 474 grid and placed in percentages, so the
 * whole bracket scales with its container rather than scrolling sideways.
 */
const S = 1232, SH = 474, W = 156, H = 54
const mirror = (x: number, w = W) => S - x - w
type StageSlot = Slot & { id: string; x: number; y: number }
const STAGE: StageSlot[] = [
  { id: "L9", x: 0, y: 40, seed: 9 }, { id: "L8", x: 0, y: 104, seed: 8 },
  { id: "L12", x: 0, y: 340, seed: 12 }, { id: "L5", x: 0, y: 404, seed: 5 },
  { id: "LQ1a", x: 176, y: 72, from: "Winner 8 / 9" }, { id: "LQ1b", x: 176, y: 136, seed: 1 },
  { id: "LQ2a", x: 176, y: 308, seed: 4 }, { id: "LQ2b", x: 176, y: 372, from: "Winner 5 / 12" },
  { id: "LS1", x: 352, y: 104, from: "Rose Bowl winner" }, { id: "LS2", x: 352, y: 340, from: "Fiesta Bowl winner" },
  { id: "LF", x: 440, y: 222, from: "Orange Bowl winner" },
  { id: "R10", x: mirror(0), y: 40, seed: 10 }, { id: "R7", x: mirror(0), y: 104, seed: 7 },
  { id: "R11", x: mirror(0), y: 340, seed: 11 }, { id: "R6", x: mirror(0), y: 404, seed: 6 },
  { id: "RQ1a", x: mirror(176), y: 72, from: "Winner 7 / 10" }, { id: "RQ1b", x: mirror(176), y: 136, seed: 2 },
  { id: "RQ2a", x: mirror(176), y: 308, seed: 3 }, { id: "RQ2b", x: mirror(176), y: 372, from: "Winner 6 / 11" },
  { id: "RS1", x: mirror(352), y: 104, from: "Peach Bowl winner" }, { id: "RS2", x: mirror(352), y: 340, from: "Cotton Bowl winner" },
  { id: "RF", x: mirror(440), y: 222, from: "Sugar Bowl winner" },
]
const CHAMPION = { x: (S - W) / 2, y: 320, w: W, h: 84 }
const LABELS: Array<{ cx: number; y: number; bowl: Bowl }> = [
  { cx: 254, y: 42, bowl: BOWL.rose }, { cx: 254, y: 278, bowl: BOWL.fiesta },
  { cx: 430, y: 74, bowl: BOWL.orange },
  { cx: S - 254, y: 42, bowl: BOWL.peach }, { cx: S - 254, y: 278, bowl: BOWL.cotton },
  { cx: S - 430, y: 74, bowl: BOWL.sugar },
  { cx: S / 2, y: 190, bowl: BOWL.title },
]

type Line = { x: number; y: number; w: number; h: number }
function stageLines(): Line[] {
  const at = Object.fromEntries(STAGE.map(s => [s.id, s])) as Record<string, StageSlot>
  const T = 3, out: Line[] = []
  const h = (x1: number, x2: number, y: number) => out.push({ x: Math.min(x1, x2), y: y - T / 2, w: Math.abs(x2 - x1) + T / 2, h: T })
  const v = (x: number, y1: number, y2: number) => out.push({ x: x - T / 2, y: Math.min(y1, y2), w: T, h: Math.abs(y2 - y1) })
  const cy = (s: StageSlot) => s.y + H / 2
  // Two slots meet and the winner moves on to `to`: rightward on the left half, leftward on the right.
  const join = (a: string, b: string, to: string) => {
    const A = at[a], B = at[b], D = at[to], left = A.x < D.x
    const xFrom = left ? A.x + W : A.x, xTo = left ? D.x : D.x + W, xMid = Math.round((xFrom + xTo) / 2)
    h(xFrom, xMid, cy(A)); h(xFrom, xMid, cy(B)); v(xMid, cy(A), cy(B)); h(xMid, xTo, cy(D))
  }
  join("L9", "L8", "LQ1a"); join("L12", "L5", "LQ2b"); join("LQ1a", "LQ1b", "LS1"); join("LQ2a", "LQ2b", "LS2")
  join("R10", "R7", "RQ1a"); join("R11", "R6", "RQ2b"); join("RQ1a", "RQ1b", "RS1"); join("RQ2a", "RQ2b", "RS2")
  // A semifinal: its two teams stacked in one column, joined down the middle, out to the finalist.
  const semi = (top: string, bottom: string, to: string) => {
    const A = at[top], B = at[bottom], D = at[to], mid = A.x + W / 2
    v(mid, A.y + H, B.y); h(mid, D.x < A.x ? D.x + W : D.x, cy(D))
  }
  semi("LS1", "LS2", "LF"); semi("RS1", "RS2", "RF")
  // The title game: the finalists meet in the middle and the line drops to the champion.
  h(at.LF.x + W, at.RF.x, cy(at.LF)); v(S / 2, cy(at.LF), CHAMPION.y)
  return out
}
const LINES = stageLines()

const pct = (n: number, of: number) => `${(n / of) * 100}%`
const place = (x: number, y: number, w: number, h: number): CSSProperties => ({ left: pct(x, S), top: pct(y, SH), width: pct(w, S), height: pct(h, SH) })

function BowlTag({ bowl }: { bowl: Bowl }) {
  return <span className="cfp-bowl-tag" data-bowl={bowl.key}>
    <CfpBowlCrest bowl={bowl.key} size={20} decorative />
    <span className="cfp-bowl-tag-name">{bowl.name}</span>
    <span className="cfp-bowl-tag-date">{bowl.date}</span>
  </span>
}

function SlotBody({ slot, teams, ranks }: { slot: Slot; teams: readonly string[]; ranks: readonly number[] | null }) {
  if (!slot.seed) return <span className="cfp-slot-hint">{slot.from}</span>
  const rank = ranks?.[slot.seed - 1]
  return <>
    <span className="cfp-slot-seed">{slot.seed}.</span>
    <strong className="cfp-slot-team">{teams[slot.seed - 1]}</strong>
    {rank ? <span className="cfp-slot-rank" aria-label={`ranked ${rank}`}>[{rank}]</span> : null}
  </>
}

function validRanks(projection: CfpProjection | null): readonly number[] | null {
  const ranks = projection?.ranks
  return Array.isArray(ranks) && ranks.length === 12 && ranks.every(rank => Number.isInteger(rank) && rank >= 1 && rank <= 25) ? ranks : null
}

export default function CfpProjectionPreview({ standalone = false }: { standalone?: boolean }) {
  const [projection, setProjection] = useState<CfpProjection | null>(null)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch("/api/brackets/cfp/projection", { cache: "no-store" })
        if (!response.ok) return
        const data = await response.json() as CfpProjection
        if (active && data.season === 2026 && Array.isArray(data.teams) && data.teams.length === 12 && typeof data.rankingDate === "string") setProjection(data)
      } catch { /* Retain the last dated projection when the provider is unavailable. */ }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const teams = projection?.teams ?? fallbackTeams
  const ranks = validRanks(projection)
  const rankingDate = projection?.rankingDate ?? "2026-11-03"
  const rankingLabel = new Date(`${rankingDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
  return <section className="cfp-preview" aria-label="Projected CFP bracket" data-testid="cfp-projection-preview">
    <div className="cfp-preview-heading">
      <div className="cfp-preview-title">
        <CfpBowlCrest bowl="title" size={64} decorative />
        <div><p className="cfp-preview-eyebrow">2026 COLLEGE FOOTBALL PLAYOFF</p><h2>See the bracket take shape</h2><p>Projected field · Subject to change</p></div>
      </div>
      <span className="cfp-preview-tag">PREVIEW ONLY</span>
    </div>
    <p className="cfp-preview-description">Based on the {rankingLabel} CFP rankings. {projection?.groupSix ?? "Boise State"} is shown as the projected Group of Six qualifier. Conference qualifiers are projected using the highest-ranked team in each conference. Teams, seeds and paths are not official; the committee announces the final field December 6.</p>
    <div className="cfp-board">
      <div className="cfp-stage" data-testid="cfp-bracket-stage" role="region" aria-label="Projected bracket">
        <div className="cfp-stage-inner">
          <span className="cfp-stage-head" aria-hidden="true" style={{ left: 0, top: 0 }}>Seed{ranks ? " · Rank" : ""}</span>
          <span className="cfp-stage-head" aria-hidden="true" style={{ right: 0, top: 0, textAlign: "right" }}>Seed{ranks ? " · Rank" : ""}</span>
          {LINES.map((line, i) => <span key={i} className="cfp-stage-line" aria-hidden="true" style={place(line.x, line.y, line.w, line.h)} />)}
          {STAGE.map(slot => <div key={slot.id} className="cfp-slot" data-slot={slot.id} data-filled={slot.seed ? "true" : undefined} style={place(slot.x, slot.y, W, H)}>
            <SlotBody slot={slot} teams={teams} ranks={ranks} />
          </div>)}
          {LABELS.map(label => <div key={label.bowl.key} className="cfp-stage-label" style={{ left: pct(label.cx, S), top: pct(label.y, SH) }}><BowlTag bowl={label.bowl} /></div>)}
          <div className="cfp-champion" style={place(CHAMPION.x, CHAMPION.y, CHAMPION.w, CHAMPION.h)}>
            <CfpBowlCrest bowl="title" size={30} decorative />
            <strong>Champion</strong>
            <span>Jan 25</span>
          </div>
        </div>
      </div>
      <div className="cfp-stack" data-testid="cfp-bracket-stack">
        {ROUNDS.map(round => <section key={round.title} className="cfp-round" aria-label={round.title}>
          <h3>{round.title} <span>{round.when}</span></h3>
          <div className="cfp-round-games">
            {round.games.map((game, i) => <article key={i} className="cfp-game">
              {game.bowl ? <BowlTag bowl={game.bowl} /> : null}
              <div className="cfp-game-card">
                {[game.a, game.b].map((slot, j) => <div key={j} className="cfp-game-row" data-filled={slot.seed ? "true" : undefined}><SlotBody slot={slot} teams={teams} ranks={ranks} /></div>)}
              </div>
            </article>)}
          </div>
        </section>)}
      </div>
    </div>
    {standalone ? <CfpBowlSchedule season={2026} series={[]} live /> : null}
    <p className="cfp-preview-footnote">Illustrative bracket paths and bowl assignments may change. This preview does not save picks or affect standings. <a href="https://collegefootballplayoff.com/rankings" target="_blank" rel="noreferrer">CFP rankings source</a>{standalone ? <> · <Link href="/brackets/leagues/new?sport=NCAAF">Create a CFP pool</Link></> : <> · <Link href="/brackets/cfp/preview">Open shareable preview</Link></>}</p>
  </section>
}
