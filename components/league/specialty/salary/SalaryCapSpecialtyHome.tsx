'use client'

import {
  SpecialtyCard,
  SpecialtyFeed,
  SpecialtyGrid,
  SpecialtyHero,
  SpecialtyRules,
  SpecialtyTag,
  spStyles,
  specialtyAsset,
} from '@/components/league/specialty/SpecialtyShell'
import type { SalaryCapSummary } from '@/components/salary-cap/types'
import { OFFSEASON_STEPS, capBarSegments, contractTags } from '@/lib/salary-cap/capHomeView'
import s from './salary-specialty.module.css'

/*
 * Salary cap league home (handoff salary/SalaryCapHome): hero with cap space, the cap bar (active,
 * dead money, rollover credit), future years against the growing cap, the contracts table, and a rail
 * with the offseason calendar, the cap rules and the latest moves. Every figure is the summary route's.
 */

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `$${(Math.round(n * 10) / 10).toFixed(1)}`

const humanEvent = (t: string) => {
  if (t === 'contract_cut') return 'A contract was cut'
  if (t === 'snake_salary_scale_applied') return 'Rookie salary scale applied'
  const w = t.replace(/_/g, ' ')
  return w.charAt(0).toUpperCase() + w.slice(1)
}

export function SalaryCapSpecialtyHome({
  summary,
  onOpenContracts,
  onOpenBid,
  tradesHref,
}: {
  summary: SalaryCapSummary
  onOpenContracts: () => void
  onOpenBid: () => void
  tradesHref: string
}) {
  const cfg = summary.config
  const lg = summary.league ?? null
  const capYear = lg?.capYear ?? summary.ledger?.capYear ?? new Date().getFullYear()
  const projection = [...summary.futureProjection].sort((a, b) => a.capYear - b.capYear)
  const thisYear = projection.find((y) => y.capYear === capYear) ?? projection[0] ?? null
  const ceiling = thisYear?.capCeiling ?? cfg.startupCap
  const ledger = summary.ledger
  const bar = ledger ? capBarSegments(ledger, ceiling) : null
  const maxCol = Math.max(1, ...projection.map((y) => Math.max(y.capCeiling, y.totalCapHit)))
  const phase = cfg.offseasonPhase ?? 'in_season'
  const dead = summary.deadContracts ?? []

  const rules = [
    'Every move is checked against this year’s cap and your future years.',
    cfg.deadMoneyEnabled
      ? `Cutting a player early costs ${cfg.deadMoneyPercentPerYear}% of the remaining salary per remaining year.`
      : 'Cutting a player early costs no dead money in this league.',
    cfg.rolloverEnabled ? `Up to ${money(cfg.rolloverMax)} of unused cap rolls over to next season.` : 'Unused cap does not roll over.',
    `Contracts run ${cfg.contractMinYears}–${cfg.contractMaxYears} years; the cap grows ${cfg.capGrowthPercent}% a year.`,
    'Trades move the contract and cap hit to the new team.',
  ]

  return (
    <>
      <SpecialtyHero
        format="salary"
        bannerSrc={specialtyAsset('salary', 'banner.svg')}
        emblemSrc={specialtyAsset('salary', 'emblem.svg')}
        emblemAlt="Salary cap league crest"
        chips={[
          lg?.sport ?? null,
          String(capYear),
          cfg.mode === 'bestball' ? 'Salary cap best ball' : 'Salary cap dynasty',
          lg?.teamCount ? `${lg.teamCount} teams` : null,
        ].filter((c): c is string => Boolean(c))}
        title={lg?.name || 'Salary Cap League'}
        headline={ledger ? `${money(ledger.totalCapHit)} of ${money(ceiling)} committed` : 'Join a team to see your cap.'}
        blurb="Every player has a salary and a contract length. Stay under the cap, plan for next year, and pay dead money when you cut someone early."
        actions={[
          { label: 'Contracts', onClick: onOpenContracts, primary: true },
          { label: 'Free-agent bids', onClick: onOpenBid, testId: 'salary-open-bid' },
          { label: 'Trade with cap check', href: tradesHref },
        ]}
        clock={
          <div className={spStyles.clock} data-testid="salary-cap-space">
            <span className={spStyles.lbl}>Cap space</span>
            <span className={spStyles.clockValue}>{ledger ? money(ledger.capSpace) : '—'}</span>
            <span className={spStyles.clockCaption}>
              of {money(ceiling)}
              {ledger && ledger.deadMoneyHit > 0 ? ` · after ${money(ledger.deadMoneyHit)} dead money` : ''}
            </span>
          </div>
        }
      />
      <SpecialtyGrid
        main={
          <>
            <SpecialtyCard
              label={`${capYear} cap`}
              icon={specialtyAsset('salary', 'icon-cap.svg')}
              aside={
                <span className={spStyles.num} style={{ fontSize: 15 }}>
                  {bar ? `${money(bar.committed)} / ${money(ceiling)}` : '—'}
                </span>
              }
              testId="salary-cap-bar"
            >
              {bar ? (
                <>
                  <div className={s.capBar} role="img" aria-label={`Active ${money(bar.active)}, dead ${money(bar.dead)}, rollover ${money(bar.rollover)}`}>
                    <span className={s.segActive} style={{ width: `${bar.activePct}%` }} />
                    <span className={s.segDead} style={{ width: `${bar.deadPct}%` }} />
                    <span className={s.segRoll} style={{ width: `${bar.rolloverPct}%` }} />
                  </div>
                  <div className={s.legend}>
                    <span>
                      <i className={s.segActive} /> Active contracts {money(bar.active)}
                    </span>
                    <span>
                      <i className={s.segDead} /> Dead money {money(bar.dead)}
                    </span>
                    <span>
                      <i className={s.segRoll} /> Rollover credit +{money(bar.rollover)}
                    </span>
                  </div>
                </>
              ) : (
                <p className={spStyles.empty}>No cap ledger yet — it starts when you hold a team.</p>
              )}
              {projection.length > 0 ? (
                <>
                  <h3 className={spStyles.lbl} style={{ margin: '10px 0 0' }}>
                    Future years · committed vs cap
                  </h3>
                  <div className={s.years}>
                    {projection.map((y) => {
                      const over = y.totalCapHit > y.capCeiling
                      return (
                        <div key={y.capYear} className={s.year}>
                          <div className={s.col}>
                            <span
                              className={`${s.fill} ${over ? s.fillOver : ''}`}
                              style={{ height: `${Math.min(100, (y.totalCapHit / maxCol) * 100)}%` }}
                            />
                            <span className={s.capLine} style={{ bottom: `${Math.min(100, (y.capCeiling / maxCol) * 100)}%` }} />
                          </div>
                          <b>{y.capYear}</b>
                          <span>
                            {money(y.totalCapHit)} / {money(y.capCeiling)}
                          </span>
                          {over ? <SpecialtyTag tone="zone">Over the cap</SpecialtyTag> : null}
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </SpecialtyCard>

            <SpecialtyCard label="Contracts" icon={specialtyAsset('salary', 'icon-contract.svg')} testId="salary-contracts">
              {summary.contracts.length === 0 && dead.length === 0 ? (
                <p className={spStyles.empty}>No contracts on your roster yet.</p>
              ) : (
                <div className={s.tblWrap}>
                  <table className={s.tbl}>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">Pos</th>
                        <th scope="col" className={s.n}>
                          Salary
                        </th>
                        <th scope="col" className={s.n}>
                          Years left
                        </th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.contracts.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.playerName ?? 'Unknown player'}</strong>
                          </td>
                          <td>
                            <span className={s.pos}>{c.position ?? '—'}</span>
                          </td>
                          <td className={s.n}>{money(c.salary)}</td>
                          <td className={s.n}>{Math.max(0, c.yearsRemaining) + 1}</td>
                          <td>
                            <div className={s.tags}>
                              {contractTags(c, cfg, capYear + 1).map((t) => (
                                <SpecialtyTag key={t.label} tone={t.tone}>
                                  {t.label}
                                </SpecialtyTag>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {dead.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.playerName ?? 'Unknown player'}</strong>
                          </td>
                          <td>
                            <span className={s.pos}>{d.position ?? '—'}</span>
                          </td>
                          <td className={s.n}>{money(d.deadThisYear)}</td>
                          <td className={s.n}>—</td>
                          <td>
                            <SpecialtyTag tone="zone">Cut · dead money</SpecialtyTag>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SpecialtyCard>
          </>
        }
        rail={
          <>
            <SpecialtyCard label="Offseason calendar" testId="salary-offseason">
              <ul className={spStyles.feed}>
                {OFFSEASON_STEPS.filter(
                  (step) => (step.phase !== 'extension' || cfg.extensionsEnabled) && (step.phase !== 'tag' || cfg.franchiseTagEnabled) && (step.phase !== 'rollover' || cfg.rolloverEnabled),
                ).map((step) => (
                  <li key={step.phase} className={spStyles.feedItem}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={specialtyAsset('salary', step.phase === 'tag' ? 'icon-tag.svg' : step.phase === 'fa_open' ? 'icon-cap.svg' : 'icon-contract.svg')}
                      alt=""
                      aria-hidden
                    />
                    <div className={spStyles.feedText}>
                      <strong>
                        {step.title}
                        {phase === step.phase ? ' · now' : ''}
                      </strong>
                      <span>{step.sub}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {phase === 'in_season' ? <p className={spStyles.empty}>In season — the offseason steps run in this order.</p> : null}
            </SpecialtyCard>
            <SpecialtyCard label="Cap rules">
              <SpecialtyRules rules={rules} />
            </SpecialtyCard>
            <SpecialtyCard label="Latest">
              <SpecialtyFeed
                empty="No cap moves yet."
                items={summary.events.slice(0, 6).map((e, i) => ({
                  id: `${e.createdAt}-${i}`,
                  icon: specialtyAsset('salary', e.eventType === 'contract_cut' ? 'icon-dead.svg' : 'icon-contract.svg'),
                  title: humanEvent(e.eventType),
                  sub: new Date(e.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                }))}
              />
            </SpecialtyCard>
          </>
        }
      />
    </>
  )
}
