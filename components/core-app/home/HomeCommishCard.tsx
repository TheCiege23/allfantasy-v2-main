'use client'

import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { homeGuideMessages } from '@/lib/core-app/messages/homeGuide'
import { InactiveLadderList } from '@/components/core-app/commissioner/InactiveLadderList'
import type { LadderEntry } from '@/lib/core-app/commissioner/inactiveLadder'
import '@/components/core-app/home/af-home-guide.css'

/**
 * "Leagues you run" on the /core home (2026-11-12). Before this, a commissioner's home said nothing
 * about the leagues they run — that lived only in the Commissioner Hub, one click and one mental
 * switch away. This is the hub's own overview (`getCommissionerOverview`), cut to its headline
 * figures and the three worst tasks, with a line on why league health matters.
 *
 * Only the props it draws cross the client boundary — never the whole overview.
 */

type CommishStat = { value: string; label: string; tone: 'accent' | 'good' | 'bad' | 'plain' }
type CommishRisk = {
  id: string
  severity: 'bad' | 'warn' | 'info'
  title: string
  detail: string
  leagueName: string | null
  action: { label: string; href: string; external: boolean } | null
}

const RISK_LIMIT = 3
/** Ladder rows on the home; the rest are on the Commissioner Hub, which draws every one. */
const LADDER_LIMIT = 3

export function HomeCommishCard({
  runCount,
  stats,
  risks,
  partial,
  ladder,
}: {
  runCount: number
  stats: CommishStat[]
  risks: CommishRisk[]
  partial: boolean
  /**
   * The inactive-manager ladder (lib/core-app/commissioner/inactiveLadder.ts). Null when it was not
   * measured, which draws nothing — an empty array is the measured "everyone is active".
   */
  ladder?: LadderEntry[] | 'off-season' | null
}) {
  const g = useMessages(homeGuideMessages)
  const shown = risks.slice(0, RISK_LIMIT)
  return (
    <section className="af3a-card af-hg-card" aria-labelledby="af-run-title">
      <header className="af-hg-cardhead">
        <h2 id="af-run-title">{g.runTitle}</h2>
        <span>{g.runSub(runCount)}</span>
      </header>
      {stats.length > 0 ? (
        <ul className="af-hg-stats">
          {stats.map((s) => (
            <li key={s.label} data-tone={s.tone === 'bad' ? 'bad' : s.tone === 'good' ? 'good' : undefined}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="af-hg-label">{g.runRisks}</p>
      {shown.length === 0 ? (
        <p className="af-hg-empty">{g.runNoRisks}</p>
      ) : (
        <ul className="af-run-risks">
          {shown.map((risk) => (
            <li key={risk.id} data-sev={risk.severity}>
              <span className="af-run-dot" aria-hidden="true" />
              <div>
                <p className="af-run-title">
                  {risk.title}
                  {risk.leagueName && !risk.title.includes(risk.leagueName) ? (
                    <span className="af-run-league"> — {risk.leagueName}</span>
                  ) : null}
                </p>
                {risk.detail ? <p className="af-run-detail">{risk.detail}</p> : null}
              </div>
              {risk.action ? (
                risk.action.external ? (
                  <a className="af3a-btn" href={risk.action.href} target="_blank" rel="noopener noreferrer">
                    {risk.action.label}
                  </a>
                ) : (
                  <Link className="af3a-btn" href={risk.action.href}>
                    {risk.action.label}
                  </Link>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {/* The card's own "why it matters" line explains the ladder, so the list does not repeat it. */}
      {ladder === 'off-season' ? (
        <InactiveLadderList entries={[]} offSeason showTeach={false} />
      ) : ladder ? (
        <InactiveLadderList entries={ladder} limit={LADDER_LIMIT} showTeach={false} />
      ) : null}
      {partial ? <p className="af-hg-note">{g.runPartial}</p> : null}
      <p className="af-decision-why af-hg-why">
        <b>{g.why}</b> {g.runTeach}
      </p>
      <Link className="af-hg-more" href="/core/commissioner">
        {g.runOpen} →
      </Link>
    </section>
  )
}

