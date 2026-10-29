'use client'
/**
 * Plan a tournament · step 2 of 4 — name the divisions and conferences.
 * TournamentIdentity.png (default), --angelic, --custom.
 */
import { useState } from 'react'
import {
  CONFERENCE_COUNT_OPTIONS, CONFERENCE_NAME_MAX, DIVISION_NAME_MAX, PRESETS, clearedIdentity, identityIssues,
  leagueDisplayName, libraryImages, libraryPath, medallionPath, presetIdentity, resizeConferences, side,
  type DivisionIdentityInput,
} from '@/lib/tournament/divisions/identity'
import { seasonArtSides } from '@/lib/tournament/seasonArtwork'
import { DivisionBadge, LeagueCrest } from './DivisionArt'
import { DivisionPresetsGallery } from './DivisionPresetsGallery'

type Slot = { kind: 'division'; index: number } | { kind: 'conference'; index: number }
const panel = 'rounded-2xl border border-white/10 bg-[#0b0d14] p-4 sm:p-5'
const label = 'text-xs font-bold uppercase tracking-[0.2em] text-slate-400'
const input = 'min-h-11 w-full rounded-xl border border-white/15 bg-[#07080d] px-3 text-[15px] font-bold text-white placeholder:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8b84a]'

export function TournamentIdentityStep({ identity, onChange, minConferences = 2, onBack, onSave, saving, error, saveLabel = 'Save and continue' }: {
  identity: DivisionIdentityInput
  onChange: (next: DivisionIdentityInput) => void
  /** The format settings' minimum (4); the identity step offers 2 only when settings allow. */
  minConferences?: number
  onBack: () => void
  onSave: () => void
  saving?: boolean
  error?: string
  /** The primary button's label; the planner passes "Continue" because it saves at step 3. */
  saveLabel?: string
}) {
  const [slot, setSlot] = useState<Slot>({ kind: 'conference', index: Math.min(5, identity.conferences.length - 1) })
  const [previewIndex, setPreviewIndex] = useState(Math.min(5, identity.conferences.length - 1))
  const [gallery, setGallery] = useState(false)
  const issues = identityIssues(identity)
  const lengthIssues = [
    ...identity.divisions.filter(d => !d.name.trim()).map(() => 'Name every division.'),
    ...identity.conferences.filter(c => !c.name.trim()).map(() => 'Name every conference.'),
  ]
  const allIssues = [...new Set([...lengthIssues, ...issues])]
  const preview = identity.conferences[Math.min(previewIndex, identity.conferences.length - 1)]!
  const [dA, dB] = identity.divisions as [DivisionIdentityInput['divisions'][number], DivisionIdentityInput['divisions'][number]]

  const setDivision = (i: number, patch: Partial<DivisionIdentityInput['divisions'][number]>) =>
    onChange({ ...identity, presetId: null, divisions: identity.divisions.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  const setConference = (i: number, patch: Partial<DivisionIdentityInput['conferences'][number]>) =>
    onChange({ ...identity, presetId: identity.presetId, conferences: identity.conferences.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const applyPreset = (id: string) => {
    const next = presetIdentity(id, identity.conferences.length)
    // Keep typed conference names and images; a preset sets the divisions.
    onChange({ ...next, conferences: identity.conferences })
  }
  const pick = (image: string) => {
    if (slot.kind === 'division') setDivision(slot.index, { emblem: image })
    else setConference(slot.index, { image })
  }
  const slotImage = slot.kind === 'division' ? identity.divisions[slot.index]?.emblem : identity.conferences[slot.index]?.image
  const slotLabel = slot.kind === 'division'
    ? `Division ${slot.index === 0 ? 'A' : 'B'} · ${identity.divisions[slot.index]?.name || 'unnamed'}`
    : `Conference ${slot.index + 1} · ${identity.conferences[slot.index]?.name || 'unnamed'}`

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
      <div className="min-w-0 space-y-5">
        <section className={panel} aria-labelledby="id-presets">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="id-presets" className={label}>1 · Start from a preset</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-bold text-slate-100" onClick={() => setGallery(g => !g)} aria-expanded={gallery}>{gallery ? 'Hide all presets' : 'See all 20'}</button>
              <button type="button" className="min-h-11 rounded-xl border border-white/15 bg-[#141724] px-4 text-sm font-bold text-white" onClick={() => onChange(clearedIdentity(identity))}>Clear for custom names</button>
            </div>
          </div>
          {gallery ? (
            <DivisionPresetsGallery selectedId={identity.presetId} onSelect={applyPreset} sampleConference={preview} />
          ) : (
            <ul className="flex snap-x gap-3 overflow-x-auto pb-2" aria-label="Division presets">
              {PRESETS.map(p => (
                <li key={p.id} className="shrink-0 snap-start">
                  <button type="button" onClick={() => applyPreset(p.id)} aria-pressed={identity.presetId === p.id}
                    className="flex min-h-11 w-40 flex-col items-center gap-2 rounded-2xl border border-white/10 bg-[#0b0d14] px-3 py-3 aria-pressed:border-[#e8b84a] aria-pressed:bg-[#1a160c]">
                    <span className="flex gap-2" aria-hidden="true">
                      <img src={medallionPath(p.a)} alt="" width={44} height={44} loading="lazy" />
                      <img src={medallionPath(p.b)} alt="" width={44} height={44} loading="lazy" />
                    </span>
                    <span className="text-sm font-bold text-white">{side(p.a).name} / {side(p.b).name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={panel} aria-labelledby="id-divisions">
          <h2 id="id-divisions" className={label + ' mb-3'}>2 · Divisions</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {identity.divisions.map((d, i) => (
              <div key={i} className="min-w-0 space-y-3 rounded-2xl border bg-[#0e1018] p-4" style={{ borderColor: side(d.sideId).mid + '66' }}>
                <div className="flex items-center gap-3">
                  <DivisionBadge division={d} size={64} />
                  <label className="min-w-0 flex-1">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Division {i === 0 ? 'A' : 'B'}</span>
                    <input className={input} value={d.name} maxLength={DIVISION_NAME_MAX} placeholder="Name this division" onChange={e => setDivision(i, { name: e.target.value })} />
                  </label>
                </div>
                <fieldset>
                  <legend className="mb-2 text-sm text-slate-400">Colour</legend>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Colour for division ${i === 0 ? 'A' : 'B'}`}>
                    {seasonArtSides.map(id => (
                      <button key={id} type="button" role="radio" aria-checked={d.sideId === id} aria-label={side(id).name}
                        onClick={() => setDivision(i, { sideId: id })}
                        className="grid h-11 w-11 place-items-center rounded-full aria-checked:ring-2 aria-checked:ring-white">
                        <span className="h-7 w-7 rounded-full" style={{ background: `radial-gradient(circle at 35% 30%, ${side(id).light}, ${side(id).mid} 55%, ${side(id).dark})` }} />
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-400">Emblem</span>
                  <button type="button" onClick={() => setSlot({ kind: 'division', index: i })} aria-pressed={slot.kind === 'division' && slot.index === i}
                    className="grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-[#07080d] aria-pressed:border-[#e8b84a]" aria-label={`Choose the emblem for division ${i === 0 ? 'A' : 'B'}`}>
                    <img src={libraryPath(d.emblem)} alt="" width={36} height={36} />
                  </button>
                  <span className="text-sm text-slate-400">Tap to choose from the library</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={panel} aria-labelledby="id-conferences">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="id-conferences" className={label}>3 · Conferences in each division</h2>
            <div role="radiogroup" aria-label="Conferences per division" className="inline-flex gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
              {CONFERENCE_COUNT_OPTIONS.map(n => (
                <button key={n} type="button" role="radio" aria-checked={identity.conferences.length === n} disabled={n < minConferences}
                  onClick={() => { onChange(resizeConferences(identity, n)); setPreviewIndex(p => Math.min(p, n - 1)); setSlot(s => s.kind === 'conference' ? { kind: 'conference', index: Math.min(s.index, n - 1) } : s) }}
                  className="min-h-11 min-w-11 rounded-lg px-3 text-sm font-bold text-slate-300 disabled:opacity-30 aria-checked:bg-[#1a1c26] aria-checked:text-[#ffd98a]">{n}</button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-sm text-slate-400">Each conference is one league per division. League names read &ldquo;{leagueDisplayName(preview.name || 'Smoke', dA.name || 'Division A')}&rdquo;.</p>
          <ol className="grid gap-2 md:grid-cols-2">
            {identity.conferences.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-6 text-right font-mono text-sm text-slate-500">{i + 1}</span>
                <button type="button" aria-label={`Choose the image for conference ${i + 1}`} aria-pressed={slot.kind === 'conference' && slot.index === i}
                  onClick={() => { setSlot({ kind: 'conference', index: i }); setPreviewIndex(i) }}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/15 bg-[#07080d] aria-pressed:border-[#e8b84a]">
                  <img src={libraryPath(c.image)} alt="" width={36} height={36} />
                </button>
                <input className={input} aria-label={`Conference ${i + 1} name`} value={c.name} maxLength={CONFERENCE_NAME_MAX} placeholder="Conference name"
                  onFocus={() => setPreviewIndex(i)} onChange={e => setConference(i, { name: e.target.value })} />
              </li>
            ))}
          </ol>
        </section>

        <section className={panel + ' border-[#e8b84a]/40'} aria-labelledby="id-library">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="id-library" className={label}>Image library · choosing for <span className="text-[#ffd98a]">{slotLabel}</span></h2>
            <span className="text-sm text-slate-500">{libraryImages.length} unnamed images · no text on any of them</span>
          </div>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 xl:grid-cols-12" role="radiogroup" aria-label={`Image for ${slotLabel}`}>
            {libraryImages.map(id => (
              <button key={id} type="button" role="radio" aria-checked={slotImage === id} aria-label={id} onClick={() => pick(id)}
                className="grid aspect-square min-h-11 place-items-center rounded-xl border border-white/10 bg-[#0e1018] p-1.5 aria-checked:border-[#e8b84a] aria-checked:bg-[#1a160c]">
                <img src={libraryPath(id)} alt="" width={48} height={48} loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <section className={panel + ' border-[#e8b84a]/40'} aria-live="polite" aria-labelledby="id-preview">
          <h2 id="id-preview" className={label}>Live preview · {preview.name || 'unnamed'}</h2>
          <div className="mt-3 grid grid-cols-2 justify-items-center gap-2">
            {[dA, dB].map((d, i) => (
              <div key={i} className="flex min-w-0 flex-col items-center gap-1">
                <LeagueCrest division={d} conference={preview} size={160} />
                <p className="truncate text-center font-extrabold" style={{ color: side(d.sideId).mid }}>{leagueDisplayName(preview.name, d.name) || 'Unnamed league'}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-3">
            <DivisionBadge division={dA} size={56} /><span className="text-lg font-black text-slate-500">VS</span><DivisionBadge division={dB} size={56} />
          </div>
          <p className="mt-2 text-center text-2xl font-black text-white">{dA.name || 'Division A'} vs {dB.name || 'Division B'}</p>
          <p className="mt-2 text-center text-sm text-slate-400">Tap any conference row to preview it. Text is set by the app, so names can change without new artwork.</p>
        </section>
        <section className={panel}>
          <h2 className={label}>Naming rules</h2>
          <ol className="mt-2 space-y-2 text-sm text-slate-200">
            {[`Division names: up to ${DIVISION_NAME_MAX} characters. Conference names: up to ${CONFERENCE_NAME_MAX}.`, 'Names must be different from each other within a tournament.', 'The commissioner can rename until registration opens.', 'Names are checked by the same content filter as team names.'].map((t, i) => (
              <li key={i} className="flex gap-3"><span className="font-bold text-[#e8b84a]">{i + 1}</span><span>{t}</span></li>
            ))}
          </ol>
        </section>
        {(allIssues.length > 0 || error) && (
          <ul role="alert" className="space-y-1 rounded-xl border border-amber-400/40 bg-amber-950/20 p-3 text-sm text-amber-200">
            {allIssues.map(m => <li key={m}>{m}</li>)}
            {error && <li>{error}</li>}
          </ul>
        )}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <button type="button" onClick={onBack} className="min-h-12 rounded-xl border border-white/15 bg-[#0e1018] font-bold text-white">Back</button>
          <button type="button" onClick={onSave} disabled={saving || allIssues.length > 0} className="min-h-12 rounded-xl bg-[#e8b84a] font-bold text-[#1a1204] disabled:opacity-40">{saving ? 'Saving…' : saveLabel}</button>
        </div>
      </aside>
    </div>
  )
}
