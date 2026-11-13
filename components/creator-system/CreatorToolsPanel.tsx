'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, PencilLine, Plus, RefreshCcw } from 'lucide-react'
import { CREATOR_LEAGUE_SPORTS } from '@/lib/creator-system/types'
import type { CreatorLeagueDto, CreatorProfileDto } from '@/lib/creator-system/types'

interface CreatorToolsPanelProps {
  creator: CreatorProfileDto
  leagues: CreatorLeagueDto[]
  baseUrl?: string
  onChanged?: () => void
}

type LeagueFormState = {
  name: string
  sport: string
  type: 'FANTASY' | 'BRACKET'
  isPublic: boolean
  description: string
  communitySummary: string
  maxMembers: string
  joinDeadline: string
  latestRecapTitle: string
  latestRecapSummary: string
  latestCommentary: string
  coverImageUrl: string
}

function emptyLeagueForm(): LeagueFormState {
  return {
    name: '',
    sport: 'NFL',
    type: 'FANTASY',
    isPublic: true,
    description: '',
    communitySummary: '',
    maxMembers: '100',
    joinDeadline: '',
    latestRecapTitle: '',
    latestRecapSummary: '',
    latestCommentary: '',
    coverImageUrl: '',
  }
}

function leagueToForm(league: CreatorLeagueDto): LeagueFormState {
  return {
    name: league.name,
    sport: league.sport,
    type: league.type,
    isPublic: league.isPublic,
    description: league.description ?? '',
    communitySummary: league.communitySummary ?? '',
    maxMembers: String(league.maxMembers),
    joinDeadline: league.joinDeadline ? league.joinDeadline.slice(0, 16) : '',
    latestRecapTitle: league.latestRecapTitle ?? '',
    latestRecapSummary: league.latestRecapSummary ?? '',
    latestCommentary: league.latestCommentary ?? '',
    coverImageUrl: league.coverImageUrl ?? '',
  }
}

export function CreatorToolsPanel({
  creator,
  leagues,
  baseUrl = '',
  onChanged,
}: CreatorToolsPanelProps) {
  const [copiedProfile, setCopiedProfile] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<LeagueFormState>(emptyLeagueForm())
  const [editForm, setEditForm] = useState<LeagueFormState>(emptyLeagueForm())

  const profileUrl = useMemo(
    () => (baseUrl ? `${baseUrl}/creators/${creator.slug}` : `/creators/${creator.slug}`),
    [baseUrl, creator.slug]
  )

  const handleCopyProfile = async () => {
    await navigator.clipboard.writeText(profileUrl)
    setCopiedProfile(true)
    setTimeout(() => setCopiedProfile(false), 1800)
  }

  const handleCreateLeague = async () => {
    setCreating(true)
    setStatus(null)
    try {
      const response = await fetch('/api/creators/me/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          maxMembers: Number(createForm.maxMembers),
          joinDeadline: createForm.joinDeadline || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(payload.error || 'Unable to create creator league')
        return
      }
      setStatus('Creator league created')
      setCreateForm(emptyLeagueForm())
      onChanged?.()
    } catch {
      setStatus('Network error while creating creator league')
    } finally {
      setCreating(false)
    }
  }

  const openLeagueEditor = (league: CreatorLeagueDto) => {
    setEditingLeagueId(league.id)
    setEditForm(leagueToForm(league))
    setStatus(null)
  }

  const handleUpdateLeague = async (leagueId: string, regenerateInvite = false) => {
    setSaving(true)
    setStatus(null)
    try {
      const response = await fetch(`/api/creator/leagues/${encodeURIComponent(leagueId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          maxMembers: Number(editForm.maxMembers),
          joinDeadline: editForm.joinDeadline || null,
          regenerateInvite,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(payload.error || 'Unable to save creator league')
        return
      }
      setStatus(regenerateInvite ? 'Invite refreshed' : 'League updated')
      onChanged?.()
    } catch {
      setStatus('Network error while saving creator league')
    } finally {
      setSaving(false)
    }
  }

  const handleShareLeague = async (leagueId: string) => {
    const response = await fetch(`/api/creator/leagues/${encodeURIComponent(leagueId)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'direct' }),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload?.url) {
      await navigator.clipboard.writeText(payload.url)
      setStatus('Invite link copied')
    }
  }

  return (
    <section
      className="space-y-6 rounded-[32px] border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 78%, transparent)',
      }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Creator tools
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Build branded public leagues, private community rooms, and share-ready recap links.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            readOnly
            value={profileUrl}
            className="min-w-[260px] rounded-2xl border px-4 py-3 text-sm bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={handleCopyProfile}
            className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {copiedProfile ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedProfile ? 'Copied' : 'Copy profile'}
          </button>
        </div>
      </div>

      <div className="rounded-[28px] border p-5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4" style={{ color: 'var(--muted)' }} />
          <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
            Create creator league
          </h3>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>League name</span>
            <input
              data-testid="creator-create-league-name"
              type="text"
              value={createForm.name}
              onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Sport</span>
            <select
              value={createForm.sport}
              onChange={(event) => setCreateForm((current) => ({ ...current, sport: event.target.value }))}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              {CREATOR_LEAGUE_SPORTS.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Type</span>
            <select
              value={createForm.type}
              onChange={(event) => setCreateForm((current) => ({ ...current, type: event.target.value as 'FANTASY' | 'BRACKET' }))}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <option value="FANTASY">Fantasy league</option>
              <option value="BRACKET">Bracket challenge</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Max members</span>
            <input
              type="number"
              min={2}
              max={5000}
              value={createForm.maxMembers}
              onChange={(event) => setCreateForm((current) => ({ ...current, maxMembers: event.target.value }))}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Description</span>
            <textarea
              value={createForm.description}
              onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Community summary</span>
            <textarea
              value={createForm.communitySummary}
              onChange={(event) => setCreateForm((current) => ({ ...current, communitySummary: event.target.value }))}
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Join deadline</span>
            <input
              type="datetime-local"
              value={createForm.joinDeadline}
              onChange={(event) => setCreateForm((current) => ({ ...current, joinDeadline: event.target.value }))}
              className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            />
          </label>
          <label className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <input
              type="checkbox"
              checked={createForm.isPublic}
              onChange={(event) => setCreateForm((current) => ({ ...current, isPublic: event.target.checked }))}
            />
            <span className="text-sm" style={{ color: 'var(--text)' }}>
              Public community room
            </span>
          </label>
        </div>

        <button
          type="button"
          disabled={creating}
          onClick={handleCreateLeague}
          data-testid="creator-create-league-submit"
          className="mt-4 rounded-2xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          {creating ? 'Creating...' : 'Create creator league'}
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <PencilLine className="h-4 w-4" style={{ color: 'var(--muted)' }} />
          <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
            Manage existing leagues
          </h3>
        </div>

        {leagues.length === 0 ? (
          <div className="rounded-2xl border p-5 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            Your creator leagues will appear here once you launch the first branded room.
          </div>
        ) : (
          <div className="space-y-4">
            {leagues.map((league) => (
              <div key={league.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)' }}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-base font-semibold" style={{ color: 'var(--text)' }}>{league.name}</p>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      {league.sport} • {league.isPublic ? 'Public' : 'Invite only'} • {league.memberCount} members
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openLeagueEditor(league)}
                      data-testid={`creator-edit-league-${league.id}`}
                      className="rounded-xl border px-3 py-2 text-sm font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShareLeague(league.id)}
                      data-testid={`creator-share-league-${league.id}`}
                      className="rounded-xl border px-3 py-2 text-sm font-semibold"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                      Copy invite
                    </button>
                  </div>
                </div>

                {editingLeagueId === league.id && (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>League name</span>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Sport</span>
                      <select
                        value={editForm.sport}
                        onChange={(event) => setEditForm((current) => ({ ...current, sport: event.target.value }))}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        {CREATOR_LEAGUE_SPORTS.map((sport) => (
                          <option key={sport} value={sport}>
                            {sport}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Description</span>
                      <textarea
                        value={editForm.description}
                        onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))}
                        rows={3}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Community summary</span>
                      <textarea
                        value={editForm.communitySummary}
                        onChange={(event) => setEditForm((current) => ({ ...current, communitySummary: event.target.value }))}
                        rows={2}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Recap title</span>
                      <input
                        type="text"
                        value={editForm.latestRecapTitle}
                        onChange={(event) => setEditForm((current) => ({ ...current, latestRecapTitle: event.target.value }))}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Cover image URL</span>
                      <input
                        type="url"
                        value={editForm.coverImageUrl}
                        onChange={(event) => setEditForm((current) => ({ ...current, coverImageUrl: event.target.value }))}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>Recap summary</span>
                      <textarea
                        value={editForm.latestRecapSummary}
                        onChange={(event) => setEditForm((current) => ({ ...current, latestRecapSummary: event.target.value }))}
                        rows={3}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>AI commentary</span>
                      <textarea
                        value={editForm.latestCommentary}
                        onChange={(event) => setEditForm((current) => ({ ...current, latestCommentary: event.target.value }))}
                        rows={3}
                        className="w-full rounded-2xl border px-4 py-3 text-sm bg-transparent"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                    </label>
                    <label className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                      <input
                        type="checkbox"
                        checked={editForm.isPublic}
                        onChange={(event) => setEditForm((current) => ({ ...current, isPublic: event.target.checked }))}
                      />
                      <span className="text-sm" style={{ color: 'var(--text)' }}>
                        Public community room
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleUpdateLeague(league.id)}
                        data-testid={`creator-save-league-${league.id}`}
                        className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                      >
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleUpdateLeague(league.id, true)}
                        data-testid={`creator-regenerate-invite-${league.id}`}
                        className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Refresh invite
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {status && (
        <p className="text-sm" style={{ color: status.includes('error') ? 'var(--destructive)' : 'var(--text)' }}>
          {status}
        </p>
      )}
    </section>
  )
}
