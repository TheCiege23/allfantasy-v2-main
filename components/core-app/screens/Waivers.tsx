'use client'

import Link from 'next/link'
import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'
import { WaiverRunClock } from '@/components/core-app/WaiverRunClock'
import { OrphanAuctionBids } from '@/components/core-app/OrphanAuctionBids'
import { TaxiStealCard } from '@/components/core-app/TaxiStealCard'
import { ResponsiveDetails } from '@/components/core-app/ResponsiveDetails'
import '@/components/core-app/af-waivers.css'
import '@/components/core-app/af-core-redraft-waivers-finder.css'
import { WaiverIntel } from '@/components/decide/WaiverIntel'
import AIWaiverRecommendationsPanel from '@/components/waivers/AIWaiverRecommendationsPanel'
import type { WaiversData } from '@/lib/core-app/waivers'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { platformLabel, verifiedHandoff } from '@/lib/core-app/platformLinks'
import { WaiverCompetitiveEdge, type WaiverEdgeState } from '@/components/core-app/screens/WaiverCompetitiveEdge'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { waiversMessages } from '@/lib/core-app/messages/waivers'
import { TopicTip } from '@/components/core-app/TopicTip'
import type { HelpTopicId } from '@/lib/core-app/helpTopics'

/**
 * Screen 7 — Waivers.
 *
 * "Targets, bids and claim order — priced against this league's FAAB and your
 * holes."
 *
 * The handoff builds the honesty rule into the design here: "Some platforms
 * don't publish remaining FAAB. When that happens AllFantasy says so." That is
 * implemented literally — an unknown budget shows the sentence, never "$0",
 * because "$0" says you have nothing to bid rather than that we do not know.
 */

export type WaiversProps = {
  data: WaiversData
  /** Competitive Edge — loaded by the page only when the viewer's plan includes it. */
  edge?: WaiverEdgeState | null
  edgeAccess?: CoreDepthAccess | null
}

export function waiverRuleText(english: string, language: string): string {
  if (language !== 'es') return english
  return english.split(' · ').map((part) => {
    let m = part.match(/^(\d+) per period$/)
    if (m) return `${m[1]} por periodo`
    m = part.match(/^\$(\d+) minimum bid$/)
    if (m) return `oferta mínima de $${m[1]}`
    return coreUiCopy(part, language)
  }).join(' · ')
}

/**
 * The share of the league's FAAB budget still left, 0–1, or null when it cannot be drawn honestly: no
 * budget on file, a zero budget, or a remaining figure above the budget (a commissioner top-up the
 * budget column does not reflect — a bar pinned at 100% would hide that). Exported for tests.
 */
export function faabTrack(remaining: number | null | undefined, budget: number | null | undefined): number | null {
  if (remaining == null || budget == null || !Number.isFinite(remaining) || !Number.isFinite(budget)) return null
  if (budget <= 0 || remaining < 0 || remaining > budget) return null
  return remaining / budget
}

function Tile({
  label,
  state,
  render,
  sub,
  help,
  tile,
}: {
  label: string
  state: SectionState<unknown>
  /** `track`, 0–1: a share of a known total, drawn as a bar only in the redraft identity (see below). */
  render?: (d: never) => { value: string; of?: string; sub?: string; track?: number | null }
  sub?: string
  /** A "?" beside the label (lib/core-app/helpTopics.ts). */
  help?: HelpTopicId
  /** Which tile this is, for the redraft stylesheet (af-core-redraft-waivers-finder.css). */
  tile?: string
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  if (!state.available) {
    return (
      <div className="af-wv-tile" data-missing="true" data-tile={tile}>
        <div className="af-wv-tile-value af-num">—</div>
        <div className="af-label">
          {copy(label)}
          {help ? <> <TopicTip topic={help} /></> : null}
        </div>
        <div className="af-wv-tile-why">{copy(state.reason)}</div>
      </div>
    )
  }
  const out: { value: string; of?: string; sub?: string; track?: number | null } = render ? render(state.data as never) : { value: String(state.data), sub }
  return (
    <div className="af-wv-tile" data-tile={tile}>
      <div className="af-wv-tile-value af-num">
        {out.value}
        {/* "/ $100" — the denominator, only when it is a real figure (the FAAB tile's league budget). */}
        {out.of ? <span className="af-wv-tile-of"> {out.of}</span> : null}
      </div>
      <div className="af-label">
        {copy(label)}
        {help ? <> <TopicTip topic={help} /></> : null}
      </div>
      {out.sub ? <div className="af-wv-tile-sub">{copy(out.sub)}</div> : null}
      {/*
        A decorative bar for a share the screen already states in text (the tile's "$63", the rules'
        "$100 budget"). Empty inline spans: with no stylesheet rule they take no space and draw nothing,
        so every league outside the redraft identity renders exactly as before (the capture script's
        dynasty control proves it pixel for pixel). aria-hidden: the figure is already read out above.
      */}
      {out.track != null ? (
        <span className="af-wv-track" aria-hidden="true" data-testid="waiver-faab-track">
          <span className="af-wv-track-fill" style={{ width: `${Math.round(out.track * 100)}%` }} />
        </span>
      ) : null}
    </div>
  )
}

export function Waivers({ data, edge = null, edgeAccess = null }: WaiversProps) {
  const { language } = useOptionalLanguage()
  const m = useMessages(waiversMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  /** A league AllFantasy runs takes its claims (and its free-agent board) here; any other is only read. */
  const claimsHere = data.league.platform !== 'manual' && platformLabel(data.league.platform) === 'AllFantasy'
  const providerClaim = verifiedHandoff(
    { id: data.league.id, platform: data.league.platform, platformLeagueId: data.league.platformLeagueId ?? null, name: data.league.name },
    'waivers',
  )
  const isFaab = data.waiverType.available && data.waiverType.data.kind === 'faab'
  /* The league's starting budget, when it was read — the denominator of the FAAB bar. */
  const faabBudget = isFaab && data.waiverType.available ? data.waiverType.data.budget : null
  const schedule = data.processTime.available ? data.processTime.data.schedule : null
  /* "FAAB blind bidding · Wednesday" — the folded rules' one line. */
  const rulesSummary = [
    data.waiverType.available ? copy(data.waiverType.data.label) : null,
    data.processTime.available ? copy(data.processTime.data.dayLabel) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    /*
      ⚠ ONE COLUMN ON A PHONE, TWO WHERE THERE IS ROOM — AND THE DOM ORDER IS THE PHONE ORDER.
      Tiles, then the actions (who to add, what to bid, who can outbid you, Chimmy), then the
      reference (the rules, the pricing note). On a wide page the reference moves to a right-hand
      column beside the actions via grid areas (af-waivers.css), measured against THIS element's
      width — a container query — because the core shell's rail takes a slice of the viewport.
    */
    <div className="af-wv" data-details-scope>
      <h1 className="af-display">{copy('Waivers')}</h1>
      {/*
        The deadline first, when there is a real one: a manager opening this tab is usually checking
        it. Only leagues whose schedule we actually imported — a Sleeper league's is not on file and
        the rules list below says so.
      */}
      {schedule ? (
        <p className="af-wv-next" data-testid="waiver-next-run">
          <span className="af-label">
            {copy('Next waiver run')} <TopicTip topic="waiverRun" />
          </span>{' '}
          <WaiverRunClock schedule={schedule} yourTime={m.yourTime} />
        </p>
      ) : null}
      <div className="af-wv-layout">
        <div className="af-wv-area-tiles">
          {/* ── Tiles ───────────────────────────────────────────────────── */}
          <div className="af-wv-tiles">
            <Tile
              label="Your FAAB"
              help="faab"
              tile="faab"
              state={data.budget}
              render={(d: never) => {
                const b = d as unknown as {
                  faabRemaining: number
                  rankByBudget: number | null
                  rostersWithBudget: number
                }
                return {
                  value: `$${b.faabRemaining}`,
                  of: faabTrack(b.faabRemaining, faabBudget) != null ? `/ $${faabBudget}` : undefined,
                  sub:
                    b.rankByBudget != null
                      ? m.budgetRank(b.rankByBudget, b.rostersWithBudget)
                      : undefined,
                  track: faabTrack(b.faabRemaining, faabBudget),
                }
              }}
            />

            <Tile
              label="Waiver priority"
              help="waiverPriority"
              tile="priority"
              state={data.waiverPriority}
              render={(d: never) => {
                const w = d as unknown as { priority: number; leagueRosters: number }
                return { value: `#${w.priority}`, sub: m.ofRosters(w.leagueRosters) }
              }}
            />

            {/*
              The next run as a KPI beside the money it spends (the redesign's strip). The same instant
              the sticky line above counts down, so on a phone — where that line is always on screen —
              this tile is hidden (af-waivers.css) rather than said twice. A schedule we have not read is
              the loader's own sentence, never a guessed day.
            */}
            {schedule && data.processTime.available ? (
              <div className="af-wv-tile" data-tile="next-run" data-testid="waiver-next-run-tile">
                <div className="af-wv-tile-value">{copy(data.processTime.data.dayLabel)}</div>
                <div className="af-label">{copy('Next waiver run')}</div>
                <div className="af-wv-tile-sub">
                  <WaiverRunClock schedule={schedule} compact />
                </div>
              </div>
            ) : (
              <Tile label="Next waiver run" tile="next-run" state={data.processTime} />
            )}

            <Tile
              label="Claims queued"
              help="claimsQueued"
              tile="claims"
              state={data.claimsQueued}
              render={(d: never) => {
                const c = d as unknown as { count: number }
                return { value: String(c.count), sub: c.count === 0 ? copy('nothing pending') : undefined }
              }}
            />

            <Tile
              label="Players held"
              tile="held"
              state={data.rosterLoad}
              render={(d: never) => {
                const r = d as unknown as { playersHeld: number; starters: number; bench: number; reserve: number }
                return {
                  value: String(r.playersHeld),
                  sub: m.rosterLoad(r.starters, r.bench, r.reserve),
                }
              }}
            />
          </div>

        </div>

        <div className="af-wv-area-main">
          {/*
            ── Orphan auction ──────────────────────────────────────────────

            First while one is open: an abandoned team's players and picks for sealed FAAB bids, with
            a closing time (lib/orphan-auction). Renders nothing when the league has no auction.
          */}
          <OrphanAuctionBids leagueId={data.league.id} />

          {/*
            ── Taxi stealing ───────────────────────────────────────────────

            Claims on your taxi players first — they have a deadline — then claims you can make
            (lib/taxi/taxiStealing.ts). Renders nothing when the league does not run the rule.
          */}
          <TaxiStealCard leagueId={data.league.id} />

          {/*
            ── Worth adding ─────────────────────────────────────────────────

            Ranked by what each add does to YOUR starting lineup, which is the
            question the two panels below do not answer: `WaiverIntel` prices a bid
            from market value and this room's history, and Chimmy writes a
            recommendation. Neither says how much a player changes your week.

            It sits FIRST deliberately — decide who helps, then decide what to pay —
            and it removes itself when it cannot form an opinion rather than leaving
            an empty card above panels that work.
          */}
          <WaiverLineupBoard
            leagueId={data.league.id}
            faab={isFaab ? { remaining: data.budget.available ? data.budget.data.faabRemaining : null } : null}
            rollingPriority={
              data.waiverType.available && data.waiverType.data.kind === 'rolling' && data.waiverPriority.available
                ? data.waiverPriority.data
                : null
            }
          />

          {/*
            ── Waiver intelligence ──────────────────────────────────────────

            ⚠ THIS SCREEN USED TO WITHHOLD SUGGESTED CLAIMS ENTIRELY, AND THE THING
            THAT COMPUTES THEM WAS ALREADY BUILT. `WaiverIntel` reads
            /api/league/waiver-intel — every winning claim in this league's history,
            plus market-value-anchored suggestions tagged against your roster holes —
            and it was mounted nowhere near this tab. The withheld panel was correct
            about the principle (never invent a bid) and wrong about the facts (a
            real one exists).

            It handles its own unsupported-platform and no-data states, returning
            null or an explicit empty rather than a fabricated bid, so mounting it
            does not weaken the honesty rule the withheld panel was protecting.
          */}
          {isFaab ? <WaiverIntel leagueId={data.league.id} surface="core" /> : null}

          {/*
            ── Competitive Edge ─────────────────────────────────────────────

            After the bid pricing, because it answers the next question: who can outbid you. Every
            other manager's FAAB left and what they have actually won this season — counts, never a
            label (lib/competitive-edge/waiverEdge.ts).
          */}
          <WaiverCompetitiveEdge access={edgeAccess} edge={edge} />

          {/*
            ── Chimmy's recommendations ─────────────────────────────────────

            Plan-gated at the route, not here: the panel renders its own locked
            state from the API's response rather than this screen deciding who may
            see it. A client-side entitlement check is a suggestion, not a gate.
          */}
          <section className="af-wv-ai">
            <AIWaiverRecommendationsPanel leagueId={data.league.id} surface="core" />
          </section>

          <div className="af-wv-actions">
            {/*
              The full free-agent board is a screen, not a panel — search, position and
              status filters, roster context and a claim flow. It already exists at
              /waiver-wire and is wired to the claim service, so this links to it
              rather than standing up a second player browser that would drift from
              the first.

              ⚠ `leagueId`, NOT `league`. Every /core screen takes `?league=`; this
              route reads `searchParams.get("leagueId")` and renders "No league
              selected" for anything else. Written as `?league=` first, which sent
              someone from a working waivers tab to an empty page.

              🛑 NATIVE LEAGUES ONLY. That board reads AllFantasy's own `Roster` rows to decide who is
              taken, and an imported league has none — so every player in the sport read as available
              (A.J. Brown, Tom Brady, a 49ers assistant coach), every projection read 0.0, and the budget
              fell back to a hard-coded $100 against a real $1,000 (Elimination Station 2, 2026-10-03).
              An imported league browses on its platform: the provider handoff below IS its player list.
            */}
            {claimsHere ? (
              <Link className="af-btn af-wv-browse" href={`/waiver-wire?leagueId=${encodeURIComponent(data.league.id)}`}>
                {copy('Browse every available player')}
              </Link>
            ) : null}

            {/*
              An imported league's claims are made on its platform, so the screen hands over to the
              provider's own player page rather than only saying where to go. `verifiedHandoff`, not
              `claimLink`: it returns null unless the link lands on that league's player page — never the
              provider's homepage, which is what the cross-league board's button used to reach. A native
              league gets nothing here; "Browse every available player" above IS its claim flow.
            */}
            {providerClaim ? (
              <a className="af-btn af-wv-browse" href={providerClaim.href} target="_blank" rel="noopener noreferrer">
                {m.claimOn(providerClaim.platformLabel)} ↗
              </a>
            ) : null}

          </div>
          {/* A league AllFantasy runs takes its claims here; an imported one is only read. */}
          <p className="af-wv-footnote">
            {data.league.platform === 'manual'
              ? copy('Claims are made on your platform. AllFantasy only reads your league.')
              : claimsHere
                ? copy('Claims for this league are made here, on AllFantasy.')
                : m.claimsMadeOn(platformLabel(data.league.platform))}
          </p>
        </div>

        <aside className="af-wv-area-side" aria-label={copy('How this league runs')}>
          {/*
            ── Waiver rules ────────────────────────────────────────────────
            Reference, not action: in the side column on a wide page, and folded to ONE LINE on a phone
            (it was four rows of rules — ~260px — between the tiles and the first thing to act on).
            The summary carries the two facts people check most, so folding hides nothing urgent.
          */}
          <ResponsiveDetails
            className="af-card af-wv-section af-wv-rules-box"
            testId="waiver-rules"
            summary={
              <>
                <span className="af-label">{copy('How waivers run here')}</span>
                {rulesSummary ? <span className="af-wv-rules-summary">{rulesSummary}</span> : null}
              </>
            }
          >
            <ul className="af-wv-rules">
              <li>
                <span className="af-wv-rule-key">
                  {copy('Waiver type')} <TopicTip topic="waiverType" />
                </span>
                {data.waiverType.available ? (
                  <span className="af-wv-rule-value">
                    {copy(data.waiverType.data.label)}
                    {data.waiverType.data.budget != null ? (
                      <span className="af-wv-rule-budget af-num">
                        ${data.waiverType.data.budget} {copy('budget')}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="af-wv-rule-why">{copy(data.waiverType.reason)}</span>
                )}
              </li>
              <li>
                <span className="af-wv-rule-key">
                  {copy('Waivers run')} <TopicTip topic="waiverRun" />
                </span>
                {data.processTime.available ? (
                  <span className="af-wv-rule-value">
                    {copy(data.processTime.data.dayLabel)}
                    {/*
                      ⚠ THE ZONE IS NOT NOISE — IT IS THE ONLY HONEST LABEL. A stored schedule
                      is processingTimeUtc, and League.timezone cannot localise it: that column
                      is @default("America/New_York") on every production league, so converting
                      would shift the hour by a timezone nobody actually chose. An observed
                      Sleeper schedule is Pacific wall-clock and says so ("03:00 Pacific").
                    */}
                    <span className="af-wv-rule-budget af-num">
                      {data.processTime.data.timeLabel}
                    </span>
                    {/*
                      An observed schedule says so: it is read off this league's own processed
                      claims, not off a setting, and the reader should know what it rests on.
                    */}
                    {data.processTime.data.observedRuns != null ? (
                      <span className="af-wv-rule-observed">
                        {m.observedRuns(data.processTime.data.observedRuns)}
                      </span>
                    ) : data.processTime.data.fromSleeperSetting ? (
                      <span className="af-wv-rule-observed">
                        {m.fromSleeperSettings}
                      </span>
                    ) : null}
                    {/* The same instant in the reader's own timezone, which IS knowable — see WaiverRunClock. */}
                    <span className="af-wv-rule-local">
                      <WaiverRunClock
                        schedule={data.processTime.data.schedule}
                        yourTime={m.yourTime}
                        localOnly
                      />
                    </span>
                  </span>
                ) : (
                  <span className="af-wv-rule-why">{copy(data.processTime.reason)}</span>
                )}
              </li>
              <li>
                <span className="af-wv-rule-key">
                  {copy('Tiebreak')} <TopicTip topic="tiebreak" />
                </span>
                {data.tiebreak.available ? (
                  <span className="af-wv-rule-value">{waiverRuleText(data.tiebreak.data, language)}</span>
                ) : (
                  <span className="af-wv-rule-why">{copy(data.tiebreak.reason)}</span>
                )}
              </li>
              <li>
                <span className="af-wv-rule-key">
                  {copy('Claim limits')} <TopicTip topic="claimLimits" />
                </span>
                {data.claimLimits.available ? (
                  <span className="af-wv-rule-value">{waiverRuleText(data.claimLimits.data, language)}</span>
                ) : (
                  <span className="af-wv-rule-why">{copy(data.claimLimits.reason)}</span>
                )}
              </li>
            </ul>
          </ResponsiveDetails>
          {/* ── Pricing context ─────────────────────────────────────────── */}
          <div className="af-wv-context">
            <span className="af-label">{copy('Priced for this league')}</span>
            <p className="af-wv-context-body">
              {m.pricedAgainst}<strong>{data.league.name}</strong>
              {data.league.format ? ` — ${data.league.format}` : ''}. {m.differentLeague}
            </p>
          </div>

        </aside>
      </div>
    </div>
  )
}

export default Waivers
