'use client'
import { useState } from 'react'
import type { SeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonArt, identityArt, seasonArtCatalog, seasonArtSides, seasonArtEmblems, seasonArtPath, type SeasonArt, type SeasonArtwork } from '@/lib/tournament/seasonArtwork'
import { SeasonCrest } from './SeasonIdentity'

const field = 'min-h-11 w-full rounded-xl border border-white/20 bg-slate-950 px-3 py-2 text-white'
export function SeasonIdentityEditor({ config, onChange }: { config: SeasonBlueprint; onChange: (next: SeasonBlueprint) => void }) {
  const [selected, setSelected] = useState(0)
  const count = Math.ceil(config.participants / 32) * 4
  const index = Math.min(selected, count - 1)
  function artwork(): SeasonArtwork {
    return { version: 1, divisions: config.divisions.map((_, i) => config.artwork?.divisions[i] ?? defaultSeasonArt(i % 2 ? 'gold' : 'black')), leagues: Array.from({ length: count }, (_, i) => identityArt(config, i)) }
  }
  function updateArt(art: SeasonArt) { const next = artwork(); next.leagues[index] = art; onChange({ ...config, artwork: next }) }
  function updateDivision(index: number, art: SeasonArt) {
    const next = artwork(); next.divisions[index] = art
    next.leagues = next.leagues.map((value, i) => i % config.divisions.length === index ? { ...value, sideId: art.sideId } : value)
    onChange({ ...config, artwork: next })
  }
  function applyPair(a: string, b: string) {
    const sides = [a, b], divisions = sides.map(id => seasonArtCatalog.sides[id as keyof typeof seasonArtCatalog.sides].name)
    const emblems = ['beast', 'goat', 'grizz', 'kings', 'rebels', 'smoke', 'stealth', 'swamp', 'thunder', 'warrior', 'basketball', 'football']
    const leagues = Array.from({ length: count }, (_, i) => ({ sideId: sides[i % 2]!, emblemId: emblems[Math.floor(i / 2)]! }))
    onChange({ ...config, divisions, leagueNames: leagues.map((art, i) => art.emblemId[0]!.toUpperCase() + art.emblemId.slice(1) + ' ' + divisions[i % 2]), artwork: { version: 1, divisions: sides.map(defaultSeasonArt), leagues } })
  }
  const art = identityArt(config, index)
  return <section className="min-w-0 max-w-full space-y-4 rounded-xl border border-amber-300/30 bg-[#0b0c12] p-4" aria-label="Tournament artwork settings">
    <h3 className="text-lg font-semibold">Division and league identity</h3>
    <p className="text-sm text-slate-300">Choose a preset to fill division names, league names and artwork. You can edit the names above. Divisions share the global points race; they do not reserve qualifying spots. Artwork freezes when rules are published.</p>
    <div className="flex snap-x gap-3 overflow-x-auto pb-2" aria-label="Division artwork presets">{seasonArtCatalog.pairs.map(pair => <button key={pair.a} type="button" className="min-h-24 w-36 shrink-0 snap-start rounded-xl border border-white/20 p-3 text-sm hover:border-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" onClick={() => applyPair(pair.a, pair.b)}><span className="flex justify-center gap-2" aria-hidden="true">{[pair.a, pair.b].map(id => <img key={id} src={seasonArtPath('medallions', id)} alt="" width={36} height={36} loading="lazy" />)}</span>{seasonArtCatalog.sides[pair.a as keyof typeof seasonArtCatalog.sides].name} / {seasonArtCatalog.sides[pair.b as keyof typeof seasonArtCatalog.sides].name}</button>)}</div>
    {config.artwork && <div className="grid gap-3 sm:grid-cols-2">{config.divisions.map((name, i) => {
      const style = config.artwork!.divisions[i] ?? defaultSeasonArt('gold')
      return <div key={i} className="space-y-2 rounded-xl border border-white/15 p-3"><p className="break-words font-semibold">{name}</p><label className="block text-sm">Palette for {name}<select className={field} value={style.sideId} onChange={e => updateDivision(i, { ...style, sideId: e.target.value })}>{seasonArtSides.map(id => <option key={id} value={id}>{seasonArtCatalog.sides[id].name}</option>)}</select></label><label className="block text-sm">Emblem for {name}<select className={field} value={style.emblemId} onChange={e => updateDivision(i, { ...style, emblemId: e.target.value })}>{seasonArtEmblems.map(id => <option key={id} value={id}>{id}</option>)}</select></label></div>
    })}</div>}
    <div className="grid gap-4 sm:grid-cols-[1fr_144px]">
      <div className="space-y-3">
        <label className="block">League artwork to edit<select className={field} value={index} onChange={e => setSelected(Number(e.target.value))}>{Array.from({ length: count }, (_, i) => <option key={i} value={i}>{config.leagueNames[i] || 'Opening League ' + (i + 1)}</option>)}</select></label>
        <label className="block">League palette<select className={field} value={art.sideId} onChange={e => updateArt({ ...art, sideId: e.target.value })}>{seasonArtSides.map(id => <option key={id} value={id}>{seasonArtCatalog.sides[id].name}</option>)}</select></label>
        <label className="block">League emblem<select className={field} value={art.emblemId} onChange={e => updateArt({ ...art, emblemId: e.target.value })}>{seasonArtEmblems.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      </div>
      <SeasonCrest art={art} name={config.leagueNames[index] || 'Opening League ' + (index + 1)} division={config.divisions[index % Math.max(1, config.divisions.length)]} />
    </div>
    <details><summary className="min-h-11 cursor-pointer py-2 text-amber-200">Browse league emblems</summary><div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{seasonArtEmblems.map(id => <button type="button" key={id} aria-label={'Use ' + id + ' emblem'} aria-pressed={art.emblemId === id} className="min-h-16 rounded-xl border border-white/20 p-2 aria-pressed:border-amber-300" onClick={() => updateArt({ ...art, emblemId: id })}><img src={seasonArtPath('library', id)} alt="" loading="lazy" width={48} height={48} className="mx-auto" /><span className="text-xs">{id}</span></button>)}</div></details>
    {config.artwork && <button type="button" className="min-h-11 rounded-xl border border-white/20 px-3 text-sm" onClick={() => { const { artwork: _unused, ...next } = config; onChange(next) }}>Use sport artwork instead</button>}
  </section>
}
