'use client'

import '@/components/core-app/af-war-brief.css'
import type { FormatBrief, ScarcityRow } from '@/lib/core-app/warRoomFormat'
import type { KeeperLine, NextSeasonView } from '@/lib/core-app/warRoomNextSeason'
import { signedPts } from '@/lib/core-app/outlookCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import type { WarPlanInput } from '@/lib/core-app/warRoomPlanPrompt'
import { WarPlanAsk } from '@/components/core-app/WarPlanAsk'

/**
 * War Room phase 3, for the league on screen: how this league is won (format brief) and the plan for
 * next season. Rules live in lib/core-app/warRoomFormat.ts and warRoomNextSeason.ts; this only draws.
 *
 * ⚠ EVERY SECTION IS INDEPENDENT. A null brief (outlook failed) or a null plan (engine threw) drops
 * that section alone; the component draws nothing only when both are absent.
 */

/** An edge or a hole is only worth naming past this many points a week. */
const NOTABLE = 1

function useCopy() {
  const { language } = useOptionalLanguage()
  return { m: useMessages(warRoomBriefMessages), language }
}

type Copy = ReturnType<typeof useCopy>['m']

const pts = (n: number) => n.toFixed(1)

function Scarcity({ rows, week, m }: { rows: ScarcityRow[]; week: number | null; m: Copy }) {
  const ranked = rows.filter((r) => r.youVsLeague != null)
  const edge = [...ranked].sort((a, b) => b.youVsLeague! - a.youVsLeague!)[0]
  const hole = [...ranked].sort((a, b) => a.youVsLeague! - b.youVsLeague!)[0]
  return (
    <>
      <p className="af-wb-note">{m.scarcityLead(week)}</p>
      <ol className="af-wb-scarcity">
        {rows.map((r) => (
          <li key={r.position} data-tone={r.youVsLeague != null && Math.abs(r.youVsLeague) >= NOTABLE ? (r.youVsLeague > 0 ? 'good' : 'bad') : undefined}>
            {/* Proportional text: a full sentence in the mono face is heavy on a phone. The "you" figure stays mono. */}
            <span>
              {m.scarcityRow(r.position, pts(r.avgStarter), r.gap == null ? null : pts(r.gap), r.bestFreeAgent?.name ?? null, r.bestFreeAgent ? pts(r.bestFreeAgent.points) : null)}
            </span>
            {r.youVsLeague != null ? <span className="af-wb-you af-num">{m.youVs(signedPts(r.youVsLeague))}</span> : null}
          </li>
        ))}
      </ol>
      {/* Unsigned: the sentence already says over or under, and "+4.2 under" reads as a contradiction. */}
      {edge && edge.youVsLeague! >= NOTABLE ? <p className="af-wb-call" data-tone="good">{m.edge(edge.position, pts(edge.youVsLeague!))}</p> : null}
      {hole && hole.youVsLeague! <= -NOTABLE ? <p className="af-wb-call" data-tone="bad">{m.hole(hole.position, pts(Math.abs(hole.youVsLeague!)))}</p> : null}
    </>
  )
}

function FormatSection({ brief, m }: { brief: FormatBrief; m: Copy }) {
  const c = brief.calendar
  const calendar = [
    c.playoffTeams ? m.playoffs(c.playoffTeams, c.byeTeams) : null,
    c.playoffStartWeek ? m.playoffStart(c.playoffStartWeek) : null,
    c.tradeDeadlineWeek ? m.deadline(c.tradeDeadlineWeek) : m.noDeadline,
    c.weeksRemaining != null ? m.weeksLeft(c.weeksRemaining) : null,
  ].filter(Boolean)
  return (
    <section className="af-wb-section" aria-labelledby="af-wb-format">
      <h2 id="af-wb-format" className="af-label af-wb-heading">
        {m.formatHeading}
      </h2>
      {brief.scarcity.length > 0 ? <Scarcity rows={brief.scarcity} week={brief.basisWeek?.week ?? null} m={m} /> : <p className="af-wb-note">{m.scarcityNone(brief.scarcityRefusal)}</p>}
      <dl className="af-wb-facts">
        {brief.lineup.length > 0 ? (
          <div>
            <dt>{m.lineupLabel}</dt>
            <dd>
              <span className="af-num">{brief.lineup.map((s) => (s.count > 1 ? `${s.count} ${s.slot}` : s.slot)).join(' · ')}</span>
              {brief.twoQb ? <span className="af-wb-flag"> {m.twoQb}</span> : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{m.scoringLabel}</dt>
          <dd>
            {brief.scoringNotes.length > 0 ? (
              <ul>
                {brief.scoringNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              m.scoringStandard
            )}
          </dd>
        </div>
        <div>
          <dt>{m.calendarLabel}</dt>
          <dd>{calendar.join(' · ')}</dd>
        </div>
      </dl>
    </section>
  )
}

function KeeperList({ label, lines, m }: { label: string; lines: KeeperLine[]; m: Copy }) {
  if (lines.length === 0) return null
  return (
    <div className="af-wb-keepers">
      <h3>{label}</h3>
      <ul>
        {lines.map((l) => (
          <li key={l.playerId} data-verdict={l.verdict}>
            {m.keeperLine(l.name, l.position, l.cost, l.surplusRounds == null ? null : signedPts(l.surplusRounds, 0))}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NextSeasonSection({ plan, m }: { plan: NextSeasonView; m: Copy }) {
  return (
    <section className="af-wb-section" aria-labelledby="af-wb-next">
      <h2 id="af-wb-next" className="af-label af-wb-heading">
        {m.nextHeading}
      </h2>
      {plan.kind === 'dynasty' ? (
        <>
          <p className="af-wb-window" data-window={plan.window}>
            {m.window(plan.window)}
          </p>
          <p className="af-wb-call">{m.posture(plan.posture)}</p>
          <p className="af-wb-note af-num">
            {[
              plan.avgStarterAge != null ? m.avgAge(plan.avgStarterAge.toFixed(1)) : null,
              m.earlyPicks(plan.earlyPickCount),
              plan.contendScore != null ? m.contendScore(Math.round(plan.contendScore)) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {plan.facts.length > 0 ? (
            <ul className="af-wb-engine-facts">
              {plan.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          {plan.missing.length > 0 ? <p className="af-wb-note">{m.partial(plan.missing.length)}</p> : null}
        </>
      ) : plan.kind === 'keeper' ? (
        <>
          <KeeperList label={m.keepLabel(plan.recommended.length, plan.maxKeepers)} lines={plan.recommended} m={m} />
          <KeeperList label={m.bubbleLabel} lines={plan.bubble} m={m} />
          <KeeperList label={m.avoidLabel} lines={plan.avoid} m={m} />
          {plan.draft && (plan.draft.consumedRounds.length > 0 || plan.draft.priorityPositions.length > 0) ? (
            <p className="af-wb-note">
              {m.draftPlan(
                plan.draft.consumedRounds.length > 0 ? plan.draft.consumedRounds.join(', ') : null,
                plan.draft.priorityPositions.length > 0 ? plan.draft.priorityPositions.join(', ') : null,
              )}
            </p>
          ) : null}
          {plan.needsMoreData ? <p className="af-wb-note">{m.keeperPartial}</p> : null}
        </>
      ) : (
        <p className="af-wb-note">
          {plan.why === 'one_season' ? m.noneOneSeason : plan.why === 'no_team' ? m.noneNoTeam : m.noneUnavailable(plan.reason)}
        </p>
      )}
    </section>
  )
}

export function WarStrategyBrief({
  format,
  nextSeason,
  plan = null,
}: {
  format: FormatBrief | null
  nextSeason: NextSeasonView | null
  /**
   * War Room phase 4: the "Plan with Chimmy" button for this league, carrying everything this view
   * computed (card, trades the viewer may see, this brief, next season). Null hides it.
   */
  plan?: { leagueId: string; input: WarPlanInput } | null
}) {
  const { m } = useCopy()
  if (!format && !nextSeason && !plan) return null
  return (
    <div className="af-wb">
      {plan ? (
        <div className="af-wb-plan">
          <WarPlanAsk leagueId={plan.leagueId} input={plan.input} />
        </div>
      ) : null}
      {format ? <FormatSection brief={format} m={m} /> : null}
      {nextSeason ? <NextSeasonSection plan={nextSeason} m={m} /> : null}
    </div>
  )
}

export default WarStrategyBrief
