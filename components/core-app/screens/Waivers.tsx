'use client'

import Link from 'next/link'
import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'
import { WaiverRunClock } from '@/components/core-app/WaiverRunClock'
import { ResponsiveDetails } from '@/components/core-app/ResponsiveDetails'
import '@/components/core-app/af-waivers.css'
import { WaiverIntel } from '@/components/decide/WaiverIntel'
import AIWaiverRecommendationsPanel from '@/components/waivers/AIWaiverRecommendationsPanel'
import type { WaiversData } from '@/lib/core-app/waivers'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { platformLabel, verifiedHandoff } from '@/lib/core-app/platformLinks'
import { WaiverCompetitiveEdge, type WaiverEdgeState } from '@/components/core-app/screens/WaiverCompetitiveEdge'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

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

function Tile({
  label,
  state,
  render,
  sub,
}: {
  label: string
  state: SectionState<unknown>
  render?: (d: never) => { value: string; sub?: string }
  sub?: string
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  if (!state.available) {
    return (
      <div className="af-wv-tile" data-missing="true">
        <div className="af-wv-tile-value af-num">—</div>
        <div className="af-label">{copy(label)}</div>
        <div className="af-wv-tile-why">{copy(state.reason)}</div>
      </div>
    )
  }
  const out = render ? render(state.data as never) : { value: String(state.data), sub }
  return (
    <div className="af-wv-tile">
      <div className="af-wv-tile-value af-num">{out.value}</div>
      <div className="af-label">{copy(label)}</div>
      {out.sub ? <div className="af-wv-tile-sub">{copy(out.sub)}</div> : null}
    </div>
  )
}

export function Waivers({ data, edge = null, edgeAccess = null }: WaiversProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const providerClaim = verifiedHandoff(
    { id: data.league.id, platform: data.league.platform, platformLeagueId: data.league.platformLeagueId ?? null, name: data.league.name },
    'waivers',
  )
  const isFaab = data.waiverType.available && data.waiverType.data.kind === 'faab'
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
          <span className="af-label">{copy('Next waiver run')}</span>{' '}
          <WaiverRunClock schedule={schedule} yourTime={es ? ' (tu hora)' : ' your time'} />
        </p>
      ) : null}
      <div className="af-wv-layout">
        <div className="af-wv-area-tiles">
          {/* ── Tiles ───────────────────────────────────────────────────── */}
          <div className="af-wv-tiles">
            <Tile
              label="Your FAAB"
              state={data.budget}
              render={(d: never) => {
                const b = d as unknown as {
                  faabRemaining: number
                  rankByBudget: number | null
                  rostersWithBudget: number
                }
                return {
                  value: `$${b.faabRemaining}`,
                  sub:
                    b.rankByBudget != null
                      ? es ? `${b.rankByBudget} de ${b.rostersWithBudget} por presupuesto restante` : `${b.rankByBudget} of ${b.rostersWithBudget} by budget left`
                      : undefined,
                }
              }}
            />

            <Tile
              label="Waiver priority"
              state={data.waiverPriority}
              render={(d: never) => {
                const w = d as unknown as { priority: number; leagueRosters: number }
                return { value: `#${w.priority}`, sub: es ? `de ${w.leagueRosters} equipos` : `of ${w.leagueRosters} rosters` }
              }}
            />

            <Tile
              label="Players held"
              state={data.rosterLoad}
              render={(d: never) => {
                const r = d as unknown as { playersHeld: number; starters: number; bench: number; reserve: number }
                return {
                  value: String(r.playersHeld),
                  sub: es ? `${r.starters} titulares · ${r.bench} suplentes${r.reserve > 0 ? ` · ${r.reserve} IR/taxi` : ''}` : `${r.starters} starting · ${r.bench} bench${r.reserve > 0 ? ` · ${r.reserve} IR/taxi` : ''}`,
                }
              }}
            />

            <Tile
              label="Claims queued"
              state={data.claimsQueued}
              render={(d: never) => {
                const c = d as unknown as { count: number }
                return { value: String(c.count), sub: c.count === 0 ? copy('nothing pending') : undefined }
              }}
            />
          </div>

        </div>

        <div className="af-wv-area-main">
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
            */}
            <Link className="af-btn af-wv-browse" href={`/waiver-wire?leagueId=${encodeURIComponent(data.league.id)}`}>
              {copy('Browse every available player')}
            </Link>

            {/*
              An imported league's claims are made on its platform, so the screen hands over to the
              provider's own player page rather than only saying where to go. `verifiedHandoff`, not
              `claimLink`: it returns null unless the link lands on that league's player page — never the
              provider's homepage, which is what the cross-league board's button used to reach. A native
              league gets nothing here; "Browse every available player" above IS its claim flow.
            */}
            {providerClaim ? (
              <a className="af-btn af-wv-browse" href={providerClaim.href} target="_blank" rel="noopener noreferrer">
                {es ? `Reclamar en ${providerClaim.platformLabel}` : `Claim on ${providerClaim.platformLabel}`} ↗
              </a>
            ) : null}

          </div>
          {/* A league AllFantasy runs takes its claims here; an imported one is only read. */}
          <p className="af-wv-footnote">
            {data.league.platform === 'manual'
              ? copy('Claims are made on your platform. AllFantasy only reads your league.')
              : platformLabel(data.league.platform) === 'AllFantasy'
                ? copy('Claims for this league are made here, on AllFantasy.')
                : es ? `Los reclamos se hacen en ${platformLabel(data.league.platform)}. AllFantasy solo lee tu liga.` : `Claims are made on ${platformLabel(data.league.platform)}. AllFantasy only reads your league.`}
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
                <span className="af-wv-rule-key">{copy('Waiver type')}</span>
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
                <span className="af-wv-rule-key">{copy('Waivers run')}</span>
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
                        {es
                          ? `según las últimas ${data.processTime.data.observedRuns} ejecuciones de esta liga`
                          : `seen over this league's last ${data.processTime.data.observedRuns} runs`}
                      </span>
                    ) : data.processTime.data.fromSleeperSetting ? (
                      <span className="af-wv-rule-observed">
                        {es ? 'según la configuración de Sleeper de esta liga' : "from this league's Sleeper settings"}
                      </span>
                    ) : null}
                    {/* The same instant in the reader's own timezone, which IS knowable — see WaiverRunClock. */}
                    <span className="af-wv-rule-local">
                      <WaiverRunClock
                        schedule={data.processTime.data.schedule}
                        yourTime={es ? ' (tu hora)' : ' your time'}
                        localOnly
                      />
                    </span>
                  </span>
                ) : (
                  <span className="af-wv-rule-why">{copy(data.processTime.reason)}</span>
                )}
              </li>
              <li>
                <span className="af-wv-rule-key">{copy('Tiebreak')}</span>
                {data.tiebreak.available ? (
                  <span className="af-wv-rule-value">{waiverRuleText(data.tiebreak.data, language)}</span>
                ) : (
                  <span className="af-wv-rule-why">{copy(data.tiebreak.reason)}</span>
                )}
              </li>
              <li>
                <span className="af-wv-rule-key">{copy('Claim limits')}</span>
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
              {es ? 'Las ofertas y recomendaciones se calculan para ' : 'Bids and targets are priced against '}<strong>{data.league.name}</strong>
              {data.league.format ? ` — ${data.league.format}` : ''}. {es ? 'Un mismo jugador puede valer distinto en otra liga.' : 'The same player is worth a different amount in a different league.'}
            </p>
          </div>

        </aside>
      </div>
    </div>
  )
}

export default Waivers
