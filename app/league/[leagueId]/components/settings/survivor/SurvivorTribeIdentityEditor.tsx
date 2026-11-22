'use client'

import { useState } from 'react'
import { PROFILE_IMAGE_ACCEPT_ATTRIBUTE, SURVIVOR_TRIBE_NAME_MAX_LENGTH_HINT } from './tribeIdentityLimits'

/**
 * The tribes as they exist once the plan is locked (before the draft): rename each one with free
 * text and give it an image, or go back to the catalogue crest. Commissioner only; members see the
 * same cards read-only. Posts to /api/leagues/:leagueId/survivor-tribes/:tribeId.
 */
export type LockedTribe = {
  id: string
  slotIndex: number
  name: string
  colorHex: string | null
  crestUrl: string | null
  markUrl: string | null
  customLogo: boolean
  memberCount: number
  members?: string[]
}

export function SurvivorTribeIdentityEditor({ leagueId, tribes, canEdit, onChange }: {
  leagueId: string
  tribes: LockedTribe[]
  canEdit: boolean
  onChange: (tribe: LockedTribe) => void
}) {
  return (
    <section className="space-y-3" data-testid="survivor-tribe-identity-editor">
      <h3 className="text-base font-semibold">Your tribes</h3>
      <p className="text-sm text-white/60">
        Tribes are set. Rename any tribe or give it its own image; the draft room and every chat use what you choose here.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tribes.map(tribe => <TribeCard key={tribe.id} leagueId={leagueId} tribe={tribe} canEdit={canEdit} onChange={onChange} />)}
      </ul>
    </section>
  )
}

function TribeCard({ leagueId, tribe, canEdit, onChange }: { leagueId: string; tribe: LockedTribe; canEdit: boolean; onChange: (tribe: LockedTribe) => void }) {
  const [name, setName] = useState(tribe.name)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/survivor-tribes/${encodeURIComponent(tribe.id)}`

  async function send(init: RequestInit, done: string) {
    setBusy(true); setNote('')
    try {
      const r = await fetch(endpoint, { method: 'PATCH', credentials: 'include', ...init })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error ?? 'Save failed')
      onChange({ ...tribe, ...json.tribe })
      setNote(done)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const color = tribe.colorHex ?? '#22d3ee'
  const dirty = name.trim() !== tribe.name
  return (
    <li className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3" data-testid={`survivor-tribe-card-${tribe.slotIndex}`}>
      <div className="flex items-center gap-3">
        {tribe.crestUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tribe.crestUrl} alt={`${tribe.name} tribe crest`} className="h-16 w-14 shrink-0 object-contain" />
        ) : (
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: color, color }}>{tribe.name.slice(0, 2).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" style={{ color }}>{tribe.name}</p>
          <p className="text-xs text-white/55">{tribe.memberCount} managers{tribe.members?.length ? `: ${tribe.members.join(', ')}` : ''}</p>
        </div>
      </div>
      {canEdit && (
        <>
          <label className="block text-sm">
            <span className="text-white/70">Tribe name</span>
            <div className="mt-1 flex gap-2">
              <input value={name} maxLength={SURVIVOR_TRIBE_NAME_MAX_LENGTH_HINT} disabled={busy} onChange={e => setName(e.target.value)}
                className="min-h-11 min-w-0 flex-1 rounded border border-white/20 bg-neutral-950 px-3" aria-label={`Rename ${tribe.name}`} />
              <button type="button" disabled={busy || !dirty} onClick={() => send({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }, 'Tribe renamed.')}
                className="min-h-11 rounded bg-amber-300 px-3 font-semibold text-black disabled:opacity-40">Rename</button>
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded border border-white/20 px-3 hover:bg-white/[0.06]">
              <span>{busy ? 'Uploading…' : 'Upload image'}</span>
              <input type="file" accept={PROFILE_IMAGE_ACCEPT_ATTRIBUTE} disabled={busy} className="sr-only" aria-label={`Upload an image for ${tribe.name}`}
                onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const form = new FormData(); form.append('file', file); void send({ body: form }, 'Tribe image updated.') }} />
            </label>
            {tribe.customLogo && (
              <button type="button" disabled={busy} onClick={() => send({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeLogo: true }) }, 'Back to the catalogue crest.')}
                className="min-h-11 rounded border border-white/20 px-3 hover:bg-white/[0.06]">Use catalogue crest</button>
            )}
          </div>
        </>
      )}
      {note && <p role="status" className="text-xs text-amber-200">{note}</p>}
    </li>
  )
}
