'use client'
/** All 20 division pairs. Selecting a pair shows both medallions and sample crests. DivisionPresets.png */
import { PRESETS, leagueDisplayName, medallionPath, side } from '@/lib/tournament/divisions/identity'
import { LeagueCrest } from './DivisionArt'

export function DivisionPresetsGallery({ selectedId, onSelect, sampleConference = { name: 'Smoke', image: 'smoke' } }: {
  selectedId: string | null
  onSelect: (presetId: string) => void
  sampleConference?: { name: string; image: string }
}) {
  const selected = PRESETS.find(p => p.id === selectedId) ?? null
  return (
    <section aria-labelledby="presets-title" className="space-y-5">
      <header>
        <h2 id="presets-title" className="text-2xl font-bold text-white">Division presets <span className="ml-2 text-lg font-normal italic text-slate-400" style={{ fontFamily: 'Caveat, cursive' }}>created by KB</span></h2>
        <p className="text-slate-300">20 contrasting pairs to start from. Every name is editable, and every image is unnamed so it fits any league.</p>
      </header>
      {selected && (
        <div className="grid items-center gap-6 rounded-2xl border border-white/10 p-5 lg:grid-cols-[1fr_auto]"
          style={{ background: `linear-gradient(90deg, ${side(selected.a).dark}55, #0b0d14 45%, #0b0d14 55%, ${side(selected.b).dark}55)` }}>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <img src={medallionPath(selected.a)} alt={side(selected.a).name} width={120} height={120} className="h-24 w-24 sm:h-32 sm:w-32" />
            <LeagueCrest division={{ name: side(selected.a).name, sideId: selected.a }} conference={sampleConference} size={150} />
            <span className="text-4xl font-black text-slate-500" aria-hidden="true">VS</span>
            <LeagueCrest division={{ name: side(selected.b).name, sideId: selected.b }} conference={sampleConference} size={150} />
            <img src={medallionPath(selected.b)} alt={side(selected.b).name} width={120} height={120} className="h-24 w-24 sm:h-32 sm:w-32" />
          </div>
          <div className="max-w-sm space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Selected pair</p>
            <p className="text-3xl font-black text-white">{selected.label}</p>
            <p className="text-sm text-slate-300">Sample crests show the conference &ldquo;{sampleConference.name}&rdquo; in each division. Commissioners can rename both divisions, swap either image and pick any colour.</p>
            <div className="flex flex-wrap gap-2">
              {[selected.a, selected.b].map(id => (
                <span key={id} className="rounded-lg border px-3 py-1 text-sm" style={{ borderColor: side(id).mid, color: side(id).mid }}>{leagueDisplayName(sampleConference.name, side(id).name)}</span>
              ))}
            </div>
          </div>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PRESETS.map(p => (
          <li key={p.id}>
            <button type="button" onClick={() => onSelect(p.id)} aria-pressed={p.id === selectedId}
              className="flex min-h-11 w-full flex-col items-center gap-2 rounded-2xl border border-white/10 bg-[#0b0d14] p-4 text-center aria-pressed:border-[#e8b84a] aria-pressed:bg-[#1a160c]">
              <span className="flex items-center gap-2" aria-hidden="true">
                <img src={medallionPath(p.a)} alt="" width={56} height={56} loading="lazy" className="h-12 w-12 sm:h-14 sm:w-14" />
                <span className="text-xs font-black text-slate-500">vs</span>
                <img src={medallionPath(p.b)} alt="" width={56} height={56} loading="lazy" className="h-12 w-12 sm:h-14 sm:w-14" />
              </span>
              <span className="text-sm font-bold text-white">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
