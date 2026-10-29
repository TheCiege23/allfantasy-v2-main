'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SpecialtyCard } from '@/components/league/specialty/SpecialtyShell'
import { buildUniverseMap, type UniverseLevel, type UniverseRow } from '@/lib/zombie/zombieHomeView'
import z from './zombie-specialty.module.css'

/*
 * The universe map (handoff zombie/ZombieHome): one card per league on the Alpha / Beta / Gamma
 * ladder, each with a strip of cells — Whisperer, Zombies, Survivors. Reads the existing universe
 * standings route, which already disguises any Whisperer this viewer may not know.
 */

const CELL_CLASS = { whisperer: z.cWhisperer, zombie: z.cZombie, survivor: z.cSurvivor } as const
const LEVEL_CLASS: Record<string, string> = { alpha: z.lAlpha, beta: z.lBeta, gamma: z.lGamma }

export function ZombieUniverseMap({ universeId, leagueId }: { universeId: string; leagueId: string }) {
  const [levels, setLevels] = useState<UniverseLevel[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/zombie-universe/${encodeURIComponent(universeId)}/standings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { standings?: UniverseRow[] }) => {
        if (alive) setLevels(buildUniverseMap(d.standings ?? [], leagueId))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [universeId, leagueId])

  if (failed) return null
  const leagueCount = levels?.reduce((n, l) => n + l.leagues.length, 0) ?? 0

  return (
    <SpecialtyCard
      label="The universe · infection by league"
      testId="zombie-universe-map"
      aside={
        <Link href={`/app/zombie-universe/${encodeURIComponent(universeId)}/standings`} className={z.leagueNote}>
          Universe standings
        </Link>
      }
    >
      {levels == null ? (
        <p className={z.leagueNote}>Loading the universe…</p>
      ) : leagueCount === 0 ? (
        <p className={z.leagueNote}>The universe fills in once its leagues have teams.</p>
      ) : (
        <>
          <div className={z.levels}>
            {levels.map((lv) => (
              <div key={lv.levelId} className={z.level}>
                <div className={z.levelHead}>
                  <strong className={LEVEL_CLASS[lv.levelName.toLowerCase()]}>{lv.levelName}</strong>
                  <span>
                    {lv.leagues.length} {lv.leagues.length === 1 ? 'league' : 'leagues'}
                  </span>
                </div>
                {lv.leagues.map((lg) => (
                  <div key={lg.leagueId} className={`${z.league} ${lg.isMine ? z.leagueMine : ''}`} data-mine={lg.isMine || undefined}>
                    <div className={z.leagueHead}>
                      <strong>
                        {lg.leagueName}
                        {lg.isMine ? ' · you' : ''}
                      </strong>
                      <span>
                        {lg.turned}/{lg.total}
                      </span>
                    </div>
                    <div className={z.strip} role="img" aria-label={`${lg.turned} of ${lg.total} turned`}>
                      {lg.cells.map((c, i) => (
                        <i key={i} className={CELL_CLASS[c]} />
                      ))}
                    </div>
                    <span className={z.leagueNote}>{lg.turned} turned</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className={z.legend}>
            <span>
              <i className={z.cSurvivor} /> Survivor
            </span>
            <span>
              <i className={z.cZombie} /> Zombie
            </span>
            <span>
              <i className={z.cWhisperer} /> Whisperer
            </span>
          </div>
        </>
      )}
    </SpecialtyCard>
  )
}
