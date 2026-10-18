'use client'

import { useEffect, useState } from 'react'
import {
  SpecialtyCard,
  SpecialtyCountdown,
  SpecialtyFeed,
  SpecialtyGrid,
  SpecialtyHero,
  SpecialtyRules,
  specialtyAsset,
  spStyles,
} from '@/components/league/specialty/SpecialtyShell'
import { devyYearTag, type DevyStashItem } from '@/lib/devy/devyHomeView'
import d from './devy-specialty.module.css'

/*
 * Devy league home (handoff devy/DevyHome): the pipeline view — pro roster and taxi counts, the devy
 * stash (school, class, AF production bar, draft year or Declared), a Declared callout that opens
 * Promotion day, pipeline by year, the devy rules and the league feed. Data: the devy summary route's
 * `league` / `my` / `feed` blocks and the promotion route's window.
 */

export type DevyHomeBlock = {
  league: { name: string | null; season: number; teamCount: number | null; rosterSize: number | null } | null
  my: {
    rosterId: string
    proRosterCount: number
    stash: DevyStashItem[]
    pipeline: { year: number; count: number }[]
  } | null
  feed: { id: string; kind: string; title: string; at: string }[]
}

type PromotionWindow = { timing: string; timingLabel: string; deadlineIso: string | null }

export function DevySpecialtyHome({
  leagueId,
  sport,
  config,
  home,
  onOpenPromotion,
  draftHref,
}: {
  leagueId: string
  sport: string
  config: { devySlotCount: number; taxiSize: number; rookieDraftRounds: number }
  home: DevyHomeBlock
  onOpenPromotion: (item: DevyStashItem) => void
  draftHref: string
}) {
  const [win, setWin] = useState<PromotionWindow | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/devy/promotion`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { promotionWindow?: PromotionWindow } | null) => {
        if (alive && j?.promotionWindow) setWin(j.promotionWindow)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [leagueId])

  const lg = home.league
  const my = home.my
  const stash = my?.stash ?? []
  const declared = stash.find((s) => s.declared) ?? null
  const season = lg?.season ?? new Date().getFullYear()
  const maxPipe = Math.max(1, ...(my?.pipeline ?? []).map((p) => p.count))
  const rosterTotal = lg?.rosterSize ?? null
  const proUsed = my?.proRosterCount ?? 0
  const gridCells = rosterTotal ?? Math.max(proUsed, 1)

  const headline = declared
    ? `${declared.name} has declared for the draft`
    : my
      ? `${stash.length} of ${config.devySlotCount} devy slots filled`
      : 'Join a team to build your devy stash.'

  return (
    <>
      <SpecialtyHero
        format="devy"
        bannerSrc={specialtyAsset('devy', 'banner.svg')}
        emblemSrc={specialtyAsset('devy', 'emblem.svg')}
        emblemAlt="Devy league crest"
        chips={[sport, String(season), 'Devy dynasty', lg?.teamCount ? `${lg.teamCount} teams` : null, `${config.devySlotCount} devy slots`].filter(
          (c): c is string => Boolean(c),
        )}
        title={lg?.name || 'Devy Dynasty'}
        headline={headline}
        blurb="Draft college players years before they turn pro. Stash them in devy slots, then promote them to your roster after the NFL draft."
        actions={[
          { label: 'My devy board', onClick: () => document.getElementById('devy-stash')?.scrollIntoView({ behavior: 'smooth' }), primary: true },
          { label: 'Promotion day', onClick: declared ? () => onOpenPromotion(declared) : undefined, disabled: !declared, testId: 'devy-open-promotion' },
          { label: 'Rookie draft order', href: draftHref },
        ]}
        clock={
          <SpecialtyCountdown
            label="Promotion deadline"
            target={win?.deadlineIso ?? null}
            fallback={win?.timingLabel ? 'Open' : '—'}
            caption={win?.timingLabel ?? 'Promotions open after the NFL draft'}
          />
        }
      />
      <SpecialtyGrid
        main={
          <>
            <div className={d.cols}>
              <div className={d.slotsCol}>
                <SpecialtyCard label="Pro roster" icon={specialtyAsset('devy', 'icon-class.svg')} aside={<span className={d.count}>{rosterTotal ? `${proUsed}/${rosterTotal}` : proUsed}</span>}>
                  <p className={spStyles.t2} style={{ margin: 0 }}>
                    Starters score every week.{rosterTotal && rosterTotal > proUsed ? ` ${rosterTotal - proUsed} open ${rosterTotal - proUsed === 1 ? 'spot' : 'spots'}.` : ''}
                  </p>
                  <div className={d.slotGrid} role="img" aria-label={`${proUsed} pro roster spots used${rosterTotal ? ` of ${rosterTotal}` : ''}`}>
                    {Array.from({ length: Math.min(gridCells, 48) }, (_, i) => (
                      <i key={i} className={i < proUsed ? undefined : d.slotOpen} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span className={spStyles.lbl}>Taxi squad</span>
                    <span className={d.count}>{config.taxiSize} spots</span>
                  </div>
                  <p className={spStyles.t3} style={{ margin: 0 }}>
                    Rookies held off the active roster. They don’t score.
                  </p>
                </SpecialtyCard>
              </div>
              <div className={d.stashCol}>
                <SpecialtyCard
                  id="devy-stash"
                  label="Devy stash · college players"
                  icon={specialtyAsset('devy', 'icon-stash.svg')}
                  aside={
                    <span className={d.count}>
                      {stash.length}/{config.devySlotCount}
                    </span>
                  }
                  testId="devy-stash"
                >
                  {stash.length === 0 ? (
                    <p className={spStyles.empty}>{my ? 'No college players stashed yet — the devy draft fills these slots.' : 'Join a team to build a stash.'}</p>
                  ) : (
                    <ul className={d.stashList}>
                      {stash.map((s) => {
                        const tag = devyYearTag(s)
                        const tone = s.declared ? d.yDeclared : s.draftEligibleYear != null && s.draftEligibleYear <= season + 1 ? d.yNext : d.yLater
                        return (
                          <li key={s.rightsId} className={d.stashRow}>
                            <span className={d.pos}>{s.position}</span>
                            <div className={d.who}>
                              <strong>{s.name}</strong>
                              <span>{[s.school, s.classLabel].filter(Boolean).join(' · ')}</span>
                            </div>
                            {s.production != null ? (
                              <span className={d.prod} role="img" aria-label={`AF production ${s.production} of 100`}>
                                <span style={{ width: `${s.production}%` }} />
                              </span>
                            ) : null}
                            <span className={`${d.yearTag} ${tone}`}>{tag}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className={spStyles.t3} style={{ margin: 0, fontSize: 12 }}>
                    Bars show the AF college production score. Devy players don’t score until promoted.
                  </p>
                </SpecialtyCard>
              </div>
            </div>
            {declared ? (
              <section className={d.callout} data-testid="devy-declared-callout">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={specialtyAsset('devy', 'icon-promote.svg')} alt="" aria-hidden />
                <div>
                  <span className={spStyles.lbl} style={{ color: 'var(--acc2)' }}>
                    Declared
                  </span>
                  <strong>{declared.name} is going pro</strong>
                  <p>
                    {declared.promotionEligible
                      ? 'He is promotion-eligible now. Promote him to your pro roster.'
                      : 'He becomes promotion-eligible after the NFL draft. You’ll need an open roster spot.'}
                  </p>
                </div>
                <button type="button" className={`${spStyles.btn} ${spStyles.btnP}`} onClick={() => onOpenPromotion(declared)}>
                  {declared.promotionEligible ? 'Promote' : 'Preview promotion'}
                </button>
              </section>
            ) : null}
          </>
        }
        rail={
          <>
            <SpecialtyCard label="Your pipeline">
              {(my?.pipeline ?? []).length === 0 ? (
                <p className={spStyles.empty}>Your pipeline fills as you stash college players.</p>
              ) : (
                <ul className={d.pipe}>
                  {(my?.pipeline ?? []).map((p, i) => (
                    <li key={p.year}>
                      <b>{p.year}</b>
                      <span className={spStyles.bar} style={{ display: 'block' }}>
                        <span style={{ width: `${(p.count / maxPipe) * 100}%`, background: ['#e8701e', '#6aa8f0', '#5a6190'][Math.min(i, 2)] }} />
                      </span>
                      <span>
                        {p.count} {p.count === 1 ? 'pro' : 'pros'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SpecialtyCard>
            <SpecialtyCard label="Devy rules">
              <SpecialtyRules
                rules={[
                  `Draft college players into ${config.devySlotCount} devy slots. They don’t count against your roster.`,
                  'When one turns pro, promote him after the NFL draft.',
                  'If a player returns to school, he stays in your stash.',
                  `Rookie drafts (${config.rookieDraftRounds} rounds) skip players already held as devy picks.`,
                ]}
              />
            </SpecialtyCard>
            <SpecialtyCard label="Latest">
              <SpecialtyFeed
                empty="No devy moves yet."
                items={home.feed.slice(0, 6).map((f) => ({
                  id: f.id,
                  icon: specialtyAsset('devy', f.kind === 'declare_detected' ? 'icon-promote.svg' : f.kind.includes('promot') ? 'icon-class.svg' : 'icon-stash.svg'),
                  title: f.title,
                  sub: new Date(f.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                }))}
              />
            </SpecialtyCard>
          </>
        }
      />
    </>
  )
}
