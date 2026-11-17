import { findStation } from '@/lib/chimmy/musicCards'

/**
 * The commissioner's draft playlist (owner's call, 2026-11-17): an AF Commissioner / AF Supreme commissioner
 * picks one AllFantasy station for the draft room, and every member is offered it while the draft runs.
 *
 * 🛑 MUSIC STAYS ONE LISTENER PER DEVICE. Nothing is broadcast and nothing plays by itself: a member hears the
 * playlist only after tapping Play, on their own device, and can stop it or play something else. AllFantasy
 * never streams audio (the player is the YouTube embed in components/app-music/AppMusicDock.tsx), and a draft
 * room that starts making noise during a pick is a bug.
 *
 * 🛑 ONLY A STATION ID IS STORED, NEVER A LINK. The playlist reaches every member's room, so it is limited to
 * the curated stations in lib/draft-music/youtube.ts. A free-text link would let one person put anything in
 * front of the whole league.
 *
 * Stored in League.settings under one key, beside the other draft_* room settings. Client-safe.
 */

export const DRAFT_PLAYLIST_SETTINGS_KEY = 'draft_room_playlist'

export type DraftPlaylist = { stationId: string; label: string; channel: string }

export type StoredDraftPlaylist = { stationId: string; setAt: string; setBy: string }

/** The playlist a league has set, or null. A station that has since been removed reads as no playlist. */
export function readDraftPlaylist(settings: unknown): DraftPlaylist | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>)[DRAFT_PLAYLIST_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const station = findStation((raw as Record<string, unknown>).stationId)
  return station ? { stationId: station.id, label: station.label, channel: station.channel } : null
}

/** A request body's station: a known id, null to clear, or undefined when it is neither. */
export function parsePlaylistChoice(body: unknown): string | null | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value = (body as Record<string, unknown>).stationId
  if (value === null || value === '') return null
  return findStation(value)?.id
}

/** The player key for the room playlist, so the room can tell it apart from music a member chose. */
export function draftPlaylistPlayKey(stationId: string): string {
  return `draft-playlist:${stationId}`
}

/** Offered from the lobby until the last pick; a finished draft has no background music. */
export function draftPlaylistOffered(status: string | null | undefined): boolean {
  return status !== 'completed'
}

/**
 * The playlist as the draft settings response carries it (`draftPlaylist`), so every member's room hears about a
 * change on its next settings poll (2026-11-17). undefined means the response did not say — keep what you have.
 */
export function readLivePlaylist(value: unknown): DraftPlaylist | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return readDraftPlaylist({ [DRAFT_PLAYLIST_SETTINGS_KEY]: { stationId: (value as Record<string, unknown>).stationId } })
}

export type PlaylistFollow = { action: 'none' } | { action: 'stop' } | { action: 'play'; stationId: string }

/**
 * What a member's player does when the room playlist changes under it.
 *
 * Only a member who is ALREADY playing the room playlist is touched: they tapped Play on "the draft playlist", so
 * they follow the commissioner — switched to the new station, or stopped when it is removed. Music a member picked
 * themselves is never touched, and a member who is not playing anything still hears nothing until they tap Play.
 * 🛑 This never STARTS music in a quiet room; it only changes or ends music that member already chose.
 */
export function followPlaylistChange(playingKey: string | null | undefined, offered: DraftPlaylist | null): PlaylistFollow {
  if (!playingKey || !playingKey.startsWith('draft-playlist:')) return { action: 'none' }
  if (!offered) return { action: 'stop' }
  return playingKey === draftPlaylistPlayKey(offered.stationId) ? { action: 'none' } : { action: 'play', stationId: offered.stationId }
}
