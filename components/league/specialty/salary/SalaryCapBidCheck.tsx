'use client'

import { useMemo, useState } from 'react'
import { SpecialtyActionButton, SpecialtyReplayButton, spStyles } from '@/components/league/specialty/SpecialtyShell'
import type { SalaryCapSummary } from '@/components/salary-cap/types'
import { bidCapPreview, bidFits, clampSalary } from '@/lib/salary-cap/capHomeView'
import s from './salary-specialty.module.css'

/*
 * Free-agent bid check (handoff salary/SalaryCapBid, the signature moment): a salary stepper, contract
 * length, and a live cap preview for every projected year. Going over the cap in any year turns the
 * preview red, shakes the verdict and blocks the bid — the same rule the cap engine enforces.
 *
 * Not in this screen, on purpose: the handoff's "Place blind bid" submission and "AF value" button.
 * The salary cap engine has no free-agent contract-bid route yet (ContractBidService only settles
 * startup-auction wins), so the action continues to Waivers rather than pretending to file a sealed bid.
 */

const money = (n: number) => `$${(Math.round(n * 10) / 10).toFixed(1)}`

export function SalaryCapBidCheck({
  summary,
  onBack,
  waiversHref,
}: {
  summary: SalaryCapSummary
  onBack: () => void
  waiversHref: string
}) {
  const cfg = summary.config
  const projection = summary.futureProjection
  const minYears = Math.max(1, cfg.contractMinYears)
  const maxYears = Math.max(minYears, cfg.contractMaxYears)
  const thisYearSpace = projection.length ? [...projection].sort((a, b) => a.capYear - b.capYear)[0].projectedSpace : 0
  const maxSalary = Math.max(cfg.minimumSalary, Math.ceil(Math.max(thisYearSpace, 0)) + 25)
  const [salary, setSalary] = useState(() => clampSalary(Math.min(10, Math.max(thisYearSpace, cfg.minimumSalary)), cfg.minimumSalary, maxSalary))
  const [years, setYears] = useState(Math.min(maxYears, Math.max(minYears, 2)))
  const [shakeKey, setShakeKey] = useState(0)

  const rows = useMemo(() => bidCapPreview(projection, salary, years), [projection, salary, years])
  const fits = bidFits(rows)
  const maxCeiling = Math.max(1, ...rows.map((r) => r.ceiling))

  const step = (d: number) => {
    const next = clampSalary(salary + d, cfg.minimumSalary, maxSalary)
    const nowFits = bidFits(bidCapPreview(projection, next, years))
    if (fits && !nowFits) setShakeKey((k) => k + 1)
    setSalary(next)
  }
  const pickYears = (y: number) => {
    const nowFits = bidFits(bidCapPreview(projection, salary, y))
    if (fits && !nowFits) setShakeKey((k) => k + 1)
    setYears(y)
  }

  return (
    <div className={spStyles.page} style={{ padding: 0 }} data-testid="salary-bid-check">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" className={spStyles.btn} onClick={onBack} aria-label="Back to the cap home" style={{ width: 44, padding: 0 }}>
          ‹
        </button>
        <div style={{ minWidth: 0 }}>
          <h2 className={spStyles.h1}>Free-agent bid</h2>
          <p className={spStyles.t2} style={{ margin: 0 }}>
            {summary.league?.name ?? 'Your league'} · check a contract against your cap before you bid
          </p>
        </div>
      </div>

      <div className={s.bid}>
        <section className={`${spStyles.card} ${spStyles.pad} ${s.bidSide}`}>
          <span className={spStyles.lbl}>The rules for this bid</span>
          <ul className={spStyles.rules}>
            <li className={spStyles.rule}>
              <b>1</b>
              <span>Minimum salary {money(cfg.minimumSalary)}.</span>
            </li>
            <li className={spStyles.rule}>
              <b>2</b>
              <span>
                Contracts run {minYears}–{maxYears} years.
              </span>
            </li>
            <li className={spStyles.rule}>
              <b>3</b>
              <span>The cap grows {cfg.capGrowthPercent}% a year; the salary stays flat.</span>
            </li>
          </ul>
        </section>

        <section className={`${spStyles.card} ${spStyles.pad} ${s.bidMain}`} style={{ gap: 16 }}>
          <span className={spStyles.lbl}>Salary per year</span>
          <div className={s.stepper}>
            <button type="button" className={`${spStyles.btn} ${s.stepBtn}`} onClick={() => step(-1)} disabled={salary <= cfg.minimumSalary} aria-label="Lower salary by $1">
              −$1
            </button>
            <output className={fits ? undefined : s.over} aria-live="polite" data-testid="salary-bid-amount">
              {money(salary)}
            </output>
            <button type="button" className={`${spStyles.btn} ${s.stepBtn}`} onClick={() => step(1)} disabled={salary >= maxSalary} aria-label="Raise salary by $1">
              +$1
            </button>
          </div>

          <span className={spStyles.lbl}>Contract length</span>
          <div className={s.yearsSeg} role="group" aria-label="Contract length">
            {Array.from({ length: maxYears - minYears + 1 }, (_, i) => minYears + i).map((y) => (
              <button key={y} type="button" className={`${spStyles.btn} ${s.yearBtn}`} aria-pressed={years === y} onClick={() => pickYears(y)}>
                {y} {y === 1 ? 'yr' : 'yrs'}
              </button>
            ))}
          </div>

          <span className={spStyles.lbl}>Cap after this bid</span>
          {rows.length === 0 ? (
            <p className={spStyles.empty}>No cap projection yet — it starts when you hold a team.</p>
          ) : (
            <ul className={s.preview} data-testid="salary-bid-preview">
              {rows.map((r) => {
                const committedPct = Math.min(100, (r.committedBefore / maxCeiling) * 100)
                const bidPct = Math.max(0, Math.min(100 - committedPct, (r.bidHit / maxCeiling) * 100))
                return (
                  <li key={r.capYear}>
                    <b>{r.capYear}</b>
                    <div className={s.pbar} role="img" aria-label={`${r.capYear}: ${money(r.left)} left`}>
                      <i className={s.pCommitted} style={{ width: `${committedPct}%` }} />
                      <i className={r.over ? s.pBidOver : s.pBid} style={{ width: `${bidPct}%` }} />
                    </div>
                    <span className={r.over ? s.over : undefined}>
                      {r.over ? `${money(-r.left)} over` : `${money(r.left)} left`}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <div key={shakeKey} className={`${s.verdict} ${fits ? '' : s.verdictOver} ${shakeKey > 0 && !fits ? spStyles.shake : ''}`} role="status">
            <p>
              {rows.length === 0
                ? 'Nothing to check yet.'
                : fits
                  ? 'Fits under the cap every year.'
                  : `Over the cap in ${rows.filter((r) => r.over).map((r) => r.capYear).join(', ')}. Lower the salary or shorten the deal.`}
            </p>
            <SpecialtyActionButton
              action={{ label: 'Continue to waivers', href: waiversHref, primary: true, disabled: !fits || rows.length === 0, testId: 'salary-bid-continue' }}
            />
            <SpecialtyReplayButton
              label="Reset"
              onReplay={() => {
                setSalary(clampSalary(Math.min(10, Math.max(thisYearSpace, cfg.minimumSalary)), cfg.minimumSalary, maxSalary))
                setYears(Math.min(maxYears, Math.max(minYears, 2)))
                setShakeKey(0)
              }}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
