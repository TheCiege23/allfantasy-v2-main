'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { EyeOff } from 'lucide-react'
import type { SurvivorSummary } from './types'
import { idolDefinition } from '@/lib/survivor/survivorIdolCatalog'
import {
  BUNDLED_SURVIVOR_IDOL_TYPES,
  SURVIVOR_IDOL_CATEGORIES,
  isSurvivorIdolTypePlayable,
  survivorIdolArt,
  survivorIdolCopy,
  survivorIdolTag,
  survivorIdolTypeIdForPower,
  type SurvivorIdolCategory,
  type SurvivorIdolLeagueValues,
  type SurvivorIdolTypeDef,
} from '@/lib/survivor/survivorIdolTypes'
import { SurvivorIdolPlay } from './SurvivorIdolPlay'
import { survivorIdolPlayEngine } from '@/lib/survivor/survivorIdolEngines'
import { SurvivorIdolCard, survivorIdolGlowStyle } from './SurvivorIdolCard'
import './survivorIdols.css'

export interface SurvivorIdolsViewProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
}

function formatPowerLabel(value: string): string {
  return idolDefinition(value).name
}

/** The catalog card for a held idol; legacy powers with their own name (Council Pass) get none. */
function cardTypeFor(powerType: string, typeById: Map<string, SurvivorIdolTypeDef>): SurvivorIdolTypeDef | undefined {
  const typeId = survivorIdolTypeIdForPower(powerType)
  const type = typeId ? typeById.get(typeId) : undefined
  return type && type.name === idolDefinition(powerType).name ? type : undefined
}

type LeagueIdolInfo = { count: number | null; values: SurvivorIdolLeagueValues; types: SurvivorIdolTypeDef[] | null }

/** League idol count and Point surge / Tribute values; types never include the sealed draw. */
function useLeagueIdolInfo(leagueId: string): LeagueIdolInfo {
  const [info, setInfo] = useState<LeagueIdolInfo>({ count: null, values: {}, types: null })
  useEffect(() => {
    let active = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-setup`, { credentials: 'include', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (!active || !payload || typeof payload !== 'object' || !payload.config) return
        setInfo({
          count: typeof payload.config.count === 'number' ? payload.config.count : null,
          values: { pointSurgePct: payload.config.pointSurgePct, tributePct: payload.config.tributePct },
          types: Array.isArray(payload.types) && payload.types.length ? payload.types : null,
        })
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [leagueId])
  return info
}

/**
 * Idol vault (survivor-theme handoff, IdolVault): the manager's own sealed idols with Play, and
 * the catalog of every idol type with its card art, tag and rules. Owner-only: `myIdols` holds
 * only the viewer's idols; the catalog never says which types are hidden in this league.
 */
export function SurvivorIdolsView({ leagueId, summary }: SurvivorIdolsViewProps) {
  const { myIdols, myRosterId, myActiveEffects = [] } = summary
  const [selectedIdolId, setSelectedIdolId] = useState<string | null>(null)
  const [usedIds, setUsedIds] = useState<string[]>([])
  const [filter, setFilter] = useState<'All' | SurvivorIdolCategory>('All')
  const [detailId, setDetailId] = useState<string>('immunity')
  const league = useLeagueIdolInfo(leagueId)
  const catalog = league.types ?? BUNDLED_SURVIVOR_IDOL_TYPES.filter(isSurvivorIdolTypePlayable)
  const typeById = useMemo(() => new Map(catalog.map(type => [type.id, type])), [catalog])

  const selectedIdol = myIdols.find(idol => idol.id === selectedIdolId)
  const heldIdols = myIdols.filter(idol => !usedIds.includes(idol.id))
  const detail = typeById.get(detailId) ?? catalog[0]
  const heldOfDetail = detail ? heldIdols.find(idol => cardTypeFor(idol.powerType, typeById)?.id === detail.id) : undefined
  const sealedCount = league.count ?? summary.config?.idolCount ?? null

  return (
    <div className="svv">
      <header className="svv-head">
        <div>
          <h2>Idol vault</h2>
          <p className="svv-sub">{catalog.length} idol types in play · 6 to 8 hidden per league, or 1 to 12 when the commissioner picks{catalog.some(type => type.alwaysIn && isSurvivorIdolTypePlayable(type)) ? ` · ${catalog.filter(type => type.alwaysIn && isSurvivorIdolTypePlayable(type)).map(type => type.name).join(' and ')} always in` : ''}{summary.idolExpiryText ? ` · ${summary.idolExpiryText}` : ''}</p>
        </div>
        {sealedCount ? <span className="svv-seal">{sealedCount} sealed in {summary.leagueName ?? 'this league'}</span> : null}
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6" aria-labelledby="svv-yours">
        <h3 id="svv-yours" className="mb-4 text-lg font-semibold text-white">Your idols · only you can see these</h3>
        {!myRosterId ? (
          <p className="text-sm text-white/50">You are not in this league as a manager.</p>
        ) : heldIdols.length === 0 ? (
          <p className="text-sm text-white/50">You have no active idols. Idols are hidden until used; transfer history is visible only where authorized.</p>
        ) : (
          <ul className="svv-held">
            {heldIdols.map((idol) => {
              const type = cardTypeFor(idol.powerType, typeById)
              const button = !survivorIdolPlayEngine(idol.powerType) ? <span className="svi-tag svi-soon">Coming soon</span> : <button type="button" className="svv-held-btn" onClick={() => setSelectedIdolId(selectedIdolId === idol.id ? null : idol.id)} aria-expanded={selectedIdolId === idol.id}>{selectedIdolId === idol.id ? 'Close' : idol.powerType === 'triple_steal' ? 'Play Steal 3' : 'Play idol'}</button>
              const player = <span className="svv-player">
                {idol.playerImageUrl
                  ? <Image src={idol.playerImageUrl} alt={`${idol.playerName ?? 'Idol player'} headshot`} width={28} height={28} unoptimized />
                  : <span aria-hidden="true">{(idol.playerName ?? '?').slice(0, 1)}</span>}
                <span>{idol.playerName ?? 'Player name unavailable'} · {idolDefinition(idol.powerType).when}{summary.idolExpiryText ? ` · ${summary.idolExpiryText}` : ''}</span>
              </span>
              return <li key={idol.id}>
                {type
                  ? <SurvivorIdolCard type={type} values={league.values} headingLevel="h4" aside={<>{player}{button}</>} />
                  : <div className="svi-card" style={survivorIdolGlowStyle(idolDefinition(idol.powerType).glow)}>{/* eslint-disable-next-line @next/next/no-img-element */}{idolDefinition(idol.powerType).id && <img className="svi-art" src={survivorIdolArt(idolDefinition(idol.powerType).id) ?? ''} alt="" />}<h4 className="svi-name">{formatPowerLabel(idol.powerType)}</h4>{player}{button}</div>}
              </li>
            })}
          </ul>
        )}
      </section>

      {selectedIdol && <div>
        <nav aria-label="Your held idols" className="mb-3 flex flex-wrap gap-2">{heldIdols.map(idol => <button key={idol.id} type="button" aria-pressed={idol.id === selectedIdolId} onClick={() => setSelectedIdolId(idol.id)} className="rounded-lg border border-amber-400/50 px-3 py-2 text-sm text-amber-100">{formatPowerLabel(idol.powerType)}</button>)}</nav>
        <SurvivorIdolPlay key={selectedIdol.id} leagueId={leagueId} idolId={selectedIdol.id} powerType={selectedIdol.powerType} onFinished={() => setUsedIds(ids => [...ids, selectedIdol.id])} />
      </div>}

      <section aria-labelledby="svv-catalog" className="svv">
        <div className="svs-row">
          <h3 id="svv-catalog" className="svs-grow text-lg font-semibold text-white">Every idol type</h3>
          <div className="svs-chips" role="group" aria-label="Filter by group">
            {(['All', ...SURVIVOR_IDOL_CATEGORIES] as const).map(name => <button key={name} type="button" className="svs-chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}
          </div>
        </div>
        <div className="svv-layout">
          <div className="svv-grid">
            {catalog.filter(type => filter === 'All' || type.category === filter).map(type => (
              <button key={type.id} type="button" className="svv-tile" aria-pressed={detail?.id === type.id} onClick={() => setDetailId(type.id)}>
                <SurvivorIdolCard type={type} values={league.values} selected={detail?.id === type.id} headingLevel="h4" comingSoon={!isSurvivorIdolTypePlayable(type)} />
              </button>
            ))}
          </div>
          {detail && <aside className="svv-detail" style={survivorIdolGlowStyle(detail.glow)} aria-label={`${detail.name} details`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={survivorIdolArt(detail.id) ?? ''} alt="" />
            <h3>{detail.name}</h3>
            <p className="svi-short" style={{ fontSize: 14 }}>{survivorIdolCopy(detail.id, detail.power, league.values)}</p>
            <span className="svi-tag" data-always={detail.alwaysIn || undefined} style={{ alignSelf: 'center' }}>{survivorIdolTag(detail)}</span>
            {!isSurvivorIdolTypePlayable(detail) && <p className="svi-short" role="note"><span className="svi-tag svi-soon">Coming soon</span> This idol is not hidden in leagues yet. It joins the draw once it can be played.</p>}
            <dl className="svv-facts">
              <div><dt>When</dt><dd>{detail.when}</dd></div>
              <div><dt>Target</dt><dd>{detail.target}</dd></div>
              <div><dt>Uses</dt><dd>Once, then it’s gone</dd></div>
              <div><dt>Visible to</dt><dd>Only the owner until played</dd></div>
            </dl>
            {heldOfDetail && isSurvivorIdolTypePlayable(detail) && <button type="button" className="svv-play" onClick={() => setSelectedIdolId(heldOfDetail.id)}>Play {detail.name}</button>}
          </aside>}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          Current power effects
        </h2>
        {myActiveEffects.length === 0 ? (
          <p className="text-sm text-white/50">No active Survivor power effects are applied to you this week.</p>
        ) : (
          <ul className="space-y-2">
            {myActiveEffects.map((effect, index) => (
              <li
                key={`${effect.rewardType}-${effect.week}-${index}`}
                className="rounded-lg border border-white/5 px-3 py-2 text-sm text-white/70"
              >
                {formatPowerLabel(effect.rewardType)}
                {effect.appliedMode === 'queued' ? ' (queued)' : effect.appliedMode === 'record_only' ? ' (tracked)' : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <EyeOff className="h-5 w-5 text-white/60" />
          Idol status key
        </h2>
        <ul className="space-y-1 text-sm text-white/60">
          <li className="flex items-center gap-2"><span className="rounded bg-white/10 px-1.5">Hidden</span> — Only you see it until played</li>
          <li className="flex items-center gap-2"><span className="rounded bg-emerald-500/20 px-1.5 text-emerald-300">Active</span> — Can be played at Elimination Council</li>
          <li className="flex items-center gap-2"><span className="rounded bg-rose-500/20 px-1.5 text-rose-300">Used</span> — Already played</li>
          <li className="flex items-center gap-2"><span className="rounded bg-white/10 px-1.5 text-white/50">Expired</span> — No longer valid</li>
        </ul>
      </section>
    </div>
  )
}
