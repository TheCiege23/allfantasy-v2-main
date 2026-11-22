'use client'
import { useTradeVisualCopy } from './useTradeVisualCopy'
import { TradeTranslationStatus } from './TradeTranslationStatus'

import type { RebuildPackage, RebuildPlan } from '@/lib/trade-intel/rebuildAdvisor'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

/**
 * The rebuild plan on the Trade Center (lib/trade-intel/rebuildAdvisor.ts) — the healthy alternative to
 * tanking. It arrives with the rosters the page already loads (`/trades/rosters` → `rebuildPlan`), so it
 * makes no request of its own. Four answers, each with its reason: sell, hold, who to target, and a fair
 * opening offer that loads into the builder.
 *
 * ⚠ RENDERS NOTHING WITHOUT A PLAN. A league where it does not apply, or an older server, sends none.
 */

function money(n: number): string {
  return Math.round(n).toLocaleString(getAppIntlLocale())
}

export function RebuildPlanCard(props: { plan: RebuildPlan | null | undefined; onStartWith: (pkg: RebuildPackage) => void }) {
  const { copy, language, translationState, retryTranslation } = useTradeVisualCopy(props.plan)
  const plan = props.plan
  if (!plan) return null
  const empty = plan.sell.length === 0 && plan.hold.length === 0 && plan.targets.length === 0

  return (
    <section className="af-tc-fits af-tc-rebuild" aria-labelledby="af-tc-rebuild-title" data-testid="rebuild-plan">
      <TradeTranslationStatus state={translationState} language={language} retry={retryTranslation} />
      <div className="af-tc-fits-head">
        <span className="af-label" id="af-tc-rebuild-title">{copy('Your rebuild plan')}</span>
        <span className="af-tc-row-sub">{copy(plan.basis)}</span>
      </div>

      {empty ? <p className="af-tc-row-sub">{copy('Nothing on your roster has a clear sell or hold call right now.')}</p> : null}

      {plan.sell.length > 0 ? (
        <div className="af-tc-rebuild-group" data-group="sell">
          <h4 className="af-tc-rebuild-h">{copy('Sell while it pays')}</h4>
          <ul className="af-tc-rebuild-list">
            {plan.sell.map((s) => (
              <li key={s.asset.id} className="af-tc-rebuild-item">
                <div className="af-tc-rebuild-row">
                  <strong>{copy(s.asset.name)}</strong>
                  <span className="af-tc-rebuild-pos">{copy(s.asset.position ?? '')}</span>
                  <span className="af-tc-spacer" />
                  <span className="af-num">{money(s.asset.value)}</span>
                </div>
                <p className="af-tc-rebuild-why">{copy(s.why)}</p>
                {s.buyers.length > 0 ? (
                  <div className="af-tc-rebuild-buyers">
                    <span>{copy('Sell to:')}</span>
                    {/* One buyer per line: each carries its own sentence, and running them together read as "Meyers., Alex". */}
                    <ul>
                      {s.buyers.map((b) => (
                        <li key={b.rosterId}>
                          <strong>{copy(b.ownerName ?? 'Another manager')}</strong> <small>{copy(b.why)}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="af-tc-rebuild-buyers">{copy('No team in the race has a spot he would start in right now.')}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.hold.length > 0 ? (
        <div className="af-tc-rebuild-group" data-group="hold">
          <h4 className="af-tc-rebuild-h">{copy('Hold for next year')}</h4>
          <ul className="af-tc-rebuild-list">
            {plan.hold.map((h) => (
              <li key={h.asset.id} className="af-tc-rebuild-item">
                <div className="af-tc-rebuild-row">
                  <strong>{copy(h.asset.name)}</strong>
                  <span className="af-tc-rebuild-pos">{copy(h.asset.position ?? '')}</span>
                  <span className="af-tc-spacer" />
                  <span className="af-num">{money(h.asset.value)}</span>
                </div>
                <p className="af-tc-rebuild-why">{copy(h.why)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.targets.length > 0 ? (
        <div className="af-tc-rebuild-group" data-group="target">
          <h4 className="af-tc-rebuild-h">{copy('Ask contenders for')}</h4>
          <ul className="af-tc-rebuild-list">
            {plan.targets.map((t) => (
              <li key={`${t.rosterId}:${t.asset.id}`} className="af-tc-rebuild-item">
                <div className="af-tc-rebuild-row">
                  <strong>{copy(t.asset.name)}</strong>
                  <span className="af-tc-rebuild-pos">{copy(t.ownerName ?? '')}</span>
                  <span className="af-tc-spacer" />
                  <span className="af-num">{money(t.asset.value)}</span>
                </div>
                <p className="af-tc-rebuild-why">{copy(t.why)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.packages.length > 0 ? (
        <div className="af-tc-rebuild-group" data-group="package">
          <h4 className="af-tc-rebuild-h">{copy('Fair offers to start from')}</h4>
          <ol className="af-tc-fits-list">
            {plan.packages.map((p) => (
              <li key={p.rosterId} className="af-tc-fit">
                <div className="af-tc-fit-head">
                  <span className="af-tc-fit-name">{copy(p.ownerName ?? 'Another manager')}</span>
                  <span className="af-tc-spacer" />
                  <span className="af-tc-fit-label af-num">{copy(`${Math.round(p.percentApart * 100)}% apart`)}</span>
                </div>
                <p className="af-tc-fit-deal af-num">
                  {copy('You send ')}
                  {copy(p.give.map((a) => `${a.name} (${money(a.value)})`).join(' + '))}
                  {copy(' · You get ')}
                  {copy(p.get.map((a) => `${a.name} (${money(a.value)})`).join(' + '))}
                </p>
                <p className="af-tc-rebuild-why">{copy(p.why)}</p>
                {p.grade?.graded ? (
                  <p className="af-tc-fit-grade" data-letter={p.grade.letter}>
                    <strong className="af-num">{copy(p.grade.letter)}</strong>
                    <span>
                      {copy('for you · ')}
                      {copy(p.ownerName ?? 'They')} {copy(p.grade.partnerLetter)}
                      {copy(' · ')}
                      {copy(p.grade.label)}
                    </span>
                  </p>
                ) : null}
                <div className="af-tc-fit-actions">
                  <button type="button" className="af-btn" onClick={() => props.onStartWith(p)}>
                    {copy('Start with this deal')}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="af-tc-rebuild-foot">
        {copy('Selling to teams in the race keeps your league competitive. Every offer here is within 15% of fair value, so none of them reads as a lopsided deal.')}
      </p>

      {plan.gaps.length > 0 ? (
        <ul className="af-tc-fits-gaps">
          {plan.gaps.map((g) => (
            <li key={g}>{copy(g)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
