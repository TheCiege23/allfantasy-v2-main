'use client'

import {
  SpecialtyCard,
  SpecialtyFeed,
  SpecialtyGrid,
  SpecialtyHero,
  SpecialtyRules,
  specialtyAsset,
  spStyles,
} from '@/components/league/specialty/SpecialtyShell'
import type { C2CCampusStarter, C2CGraduatingItem } from '@/lib/merged-devy-c2c/c2cHomeView'
import c from './c2c-specialty.module.css'

/*
 * C2C (Campus to Canton) league home (handoff c2c/C2CHome): the campus lineup and the pro side, the
 * campus share of your score, college rights about to graduate, how C2C works and the feed. Data: the
 * merged-devy-c2c summary route's `league` / `my` / `feed` blocks.
 *
 * Honest about what the data holds: the campus lineup is per-player with the latest scored week; the
 * pro side and the split come from the C2C standings (season totals), so they are labelled "season".
 * "Canton" names the city only — no Hall of Fame marks.
 */

export type C2CHomeBlock = {
  league: { name: string | null; season: number; teamCount: number | null } | null
  my: {
    rosterId: string
    campus: { starters: C2CCampusStarter[]; latestWeek: number | null; total: number | null }
    season: { rank: number; proPoints: number; collegePoints: number; combinedPoints: number; campusShare: number | null } | null
    graduating: C2CGraduatingItem[]
  } | null
  feed: { id: string; kind: string; title: string; at: string }[]
}

const pts = (n: number | null | undefined) => (n == null ? '—' : (Math.round(n * 10) / 10).toFixed(1))

const STANDINGS_COPY: Record<string, string> = {
  unified: 'Both lineups score every week and add up to one total.',
  separate: 'Campus and pro each keep their own standings.',
  hybrid: 'Campus and pro are weighted into one championship score.',
}

export function C2CSpecialtyHome({
  sport,
  standingsModel,
  mergedStartupDraft,
  home,
  lineupHref,
  draftHref,
}: {
  sport: string
  standingsModel: string
  mergedStartupDraft: boolean
  home: C2CHomeBlock
  lineupHref: string
  draftHref: string
}) {
  const lg = home.league
  const my = home.my
  const season = my?.season ?? null
  const share = season?.campusShare ?? null
  const campus = my?.campus ?? null

  return (
    <>
      <SpecialtyHero
        format="c2c"
        bannerSrc={specialtyAsset('c2c', 'banner.svg')}
        emblemSrc={specialtyAsset('c2c', 'emblem.svg')}
        emblemAlt="Campus to Canton league crest"
        chips={[sport === 'NFL' || !sport ? 'NFL + NCAAF' : sport, lg ? String(lg.season) : null, 'C2C dynasty', lg?.teamCount ? `${lg.teamCount} teams` : null].filter(
          (x): x is string => Boolean(x),
        )}
        title={lg?.name || 'Campus to Canton'}
        headline={
          season
            ? `Rank ${season.rank} · ${pts(season.combinedPoints)} points this season`
            : my
              ? 'Your two lineups score once the season starts.'
              : 'Join a team to set your two lineups.'
        }
        blurb="One dynasty, two lineups. Your college lineup scores on Saturday, your pro lineup scores on Sunday, and together they’re your score. College players graduate onto your pro roster."
        actions={[
          { label: 'Set both lineups', href: lineupHref, primary: true },
          { label: mergedStartupDraft ? 'Merged draft board' : 'Draft board', href: draftHref },
          { label: 'College rights', onClick: () => document.getElementById('c2c-rights')?.scrollIntoView({ behavior: 'smooth' }) },
        ]}
        clock={
          <div className={spStyles.clock} data-testid="c2c-season-score">
            <span className={spStyles.lbl}>Your season score</span>
            <span className={spStyles.clockValue}>{pts(season?.combinedPoints)}</span>
            <span className={spStyles.clockCaption}>
              Campus {pts(season?.collegePoints)} + Pro {pts(season?.proPoints)}
            </span>
          </div>
        }
      />
      <SpecialtyGrid
        main={
          <>
            <div className={c.lineups}>
              <section className={`${spStyles.card} ${spStyles.pad} ${c.lineup} ${c.campus}`} style={{ borderColor: 'rgba(232,112,30,.45)' }} data-testid="c2c-campus-lineup">
                <div className={c.lineupHead}>
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={specialtyAsset('c2c', 'icon-campus.svg')} alt="" aria-hidden />
                    <span>
                      <b>Campus lineup · Saturday</b>
                      <small>NCAAF scoring{campus?.latestWeek != null ? ` · week ${campus.latestWeek}` : ''}</small>
                    </span>
                  </div>
                  <strong>{pts(campus?.total)}</strong>
                </div>
                {campus && campus.starters.length > 0 ? (
                  <ul className={c.rows}>
                    {campus.starters.map((p) => (
                      <li key={p.rightsId}>
                        <span className={`${c.slot} ${c.slotCampus}`}>{p.position}</span>
                        <strong>{p.name}</strong>
                        <small>{p.school}</small>
                        <b>{pts(p.points)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={spStyles.empty}>No campus starters set yet.</p>
                )}
              </section>
              <span className={c.plus} aria-hidden>
                +
              </span>
              <section className={`${spStyles.card} ${spStyles.pad} ${c.lineup} ${c.pro}`} style={{ borderColor: 'rgba(201,162,74,.45)' }} data-testid="c2c-pro-lineup">
                <div className={c.lineupHead}>
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={specialtyAsset('c2c', 'icon-pro.svg')} alt="" aria-hidden />
                    <span>
                      <b>Pro lineup · Sunday</b>
                      <small>NFL scoring · season</small>
                    </span>
                  </div>
                  <strong>{pts(season?.proPoints)}</strong>
                </div>
                <p className={spStyles.t2} style={{ margin: 0 }}>
                  Your pro starters are set on My Team, like any dynasty lineup. Their points add to your campus score.
                </p>
                <div className={spStyles.actions}>
                  <a className={spStyles.btn} href={lineupHref}>
                    Open my pro lineup
                  </a>
                </div>
              </section>
            </div>
            <section className={`${spStyles.card} ${spStyles.pad}`} data-testid="c2c-split">
              <span className={spStyles.lbl}>Season split</span>
              <div className={c.split}>
                <div className={c.splitNums}>
                  <b>{pts(season?.collegePoints)}</b>
                  <span>campus</span>
                  <b>{pts(season?.proPoints)}</b>
                  <span>pro</span>
                </div>
                <div className={c.splitBar}>
                  <div role="img" aria-label={share == null ? 'No points yet' : `${Math.round(share * 100)}% campus`}>
                    <i className={c.iCampus} style={{ width: `${share == null ? 0 : share * 100}%` }} />
                    <i className={c.iPro} style={{ width: `${share == null ? 0 : (1 - share) * 100}%` }} />
                  </div>
                  <span>{share == null ? 'No points yet this season.' : `${Math.round(share * 100)}% of your score came from campus this season`}</span>
                </div>
              </div>
            </section>
          </>
        }
        rail={
          <>
            <SpecialtyCard id="c2c-rights" label="College rights · graduating next spring" testId="c2c-graduating">
              {my && my.graduating.length > 0 ? (
                <ul className={c.grad}>
                  {my.graduating.map((g) => (
                    <li key={g.rightsId}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={specialtyAsset('c2c', 'icon-class.svg')} alt="" aria-hidden />
                      <strong>{g.name}</strong>
                      <span>{g.status}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={spStyles.empty}>Nobody graduating next spring.</p>
              )}
              <p className={spStyles.t3} style={{ margin: 0, fontSize: 12.5 }}>
                Graduates move from your campus roster to your pro roster. You keep the rights.
              </p>
            </SpecialtyCard>
            <SpecialtyCard label="How C2C works">
              <SpecialtyRules
                rules={[
                  'Two rosters in one dynasty: campus (college) and pro.',
                  STANDINGS_COPY[standingsModel] ?? STANDINGS_COPY.unified,
                  mergedStartupDraft ? 'The startup draft mixes college rounds and pro rounds.' : 'College and pro have their own startup drafts.',
                  'College players graduate to your pro roster when they turn pro.',
                ]}
              />
            </SpecialtyCard>
            <SpecialtyCard label="Latest">
              <SpecialtyFeed
                empty="No graduations or promotions yet."
                items={home.feed.slice(0, 6).map((f) => ({
                  id: f.id,
                  icon: specialtyAsset('c2c', f.kind.includes('promot') ? 'icon-promote.svg' : 'icon-class.svg'),
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
