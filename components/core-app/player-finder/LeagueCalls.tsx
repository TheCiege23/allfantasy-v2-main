'use client'

import { COMMS_OPEN_EVENT, type CommsOpenDetail } from '@/components/core-app/comms/commsEvents'
import { chimmyAsk, type LeagueCall } from '@/lib/core-app/leagueCall'

/**
 * "Your call, league by league" — one computed start/sit call per league you have him in
 * (lib/core-app/leagueCall.ts), each with the reason it rests on.
 *
 * - The change itself is made on the league's platform — the league table's "Open lineup" goes
 *   there (AllFantasy leagues: the league's lineup editor).
 * - "Ask Chimmy" opens the Chimmy drawer scoped to THAT league with the question typed in. It
 *   does not send: a send is the paid step, and it is yours to take.
 */

function askChimmy(detail: CommsOpenDetail) {
  window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
}

export function LeagueCalls({ calls, playerName }: { calls: LeagueCall[]; playerName: string }) {
  if (calls.length === 0) return null
  // What needs you first: sit/start before hold, locked last.
  // A questionable hold (tone warn) still needs a plan, so it sits above a settled one.
  const rank = (c: LeagueCall) => (c.kind === 'sit' ? 0 : c.kind === 'start' ? 1 : c.kind === 'hold' && c.tone === 'warn' ? 2 : c.kind === 'hold' ? 3 : 4)
  const sorted = [...calls].sort((a, b) => rank(a) - rank(b) || a.leagueName.localeCompare(b.leagueName))
  return (
    <section className="af-card af-pf-calls" aria-labelledby="af-pf-calls-h">
      <h3 className="af-label" id="af-pf-calls-h">
        Your call, league by league
      </h3>
      <ul className="af-pf-calls-list">
        {sorted.map((c) => {
          return (
            <li key={c.leagueId} className="af-pf-call" data-kind={c.kind} data-tone={c.tone}>
              <div className="af-pf-call-head">
                <span className="af-pf-call-league">{c.leagueName}</span>
                <span className="af-chip af-num af-pf-call-chip" data-tone={c.tone}>
                  {c.headline}
                </span>
              </div>
              <p className="af-pf-call-why">{c.why}</p>
              <div className="af-pf-call-actions">
                {/*
                  Fix it where the league lives — only on a call that asks for a change (sit, start, or a
                  questionable hold with a plan), and only to a VERIFIED lineup screen or the in-app editor
                  (lineupFixLink). A locked or settled call has nothing to fix.
                */}
                {c.fix && (c.kind === 'sit' || c.kind === 'start' || (c.kind === 'hold' && c.tone === 'warn')) ? (
                  <a
                    className="af-pf-call-fix"
                    href={c.fix.href}
                    {...(c.fix.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    Fix lineup in {c.fix.platformLabel}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="af-pf-call-ask"
                  onClick={() => askChimmy({ tab: 'chimmy', prefill: chimmyAsk(c, playerName), leagueId: c.leagueId })}
                >
                  Ask Chimmy
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="af-pf-calls-foot">
        Each call compares projections under that league&apos;s own scoring, his injury designation and the week&apos;s kickoffs — nothing
        else. Make the change where the league lives — &ldquo;Fix lineup&rdquo; on the call, or the table&apos;s &ldquo;Open lineup&rdquo; above.
      </p>
    </section>
  )
}

export default LeagueCalls
