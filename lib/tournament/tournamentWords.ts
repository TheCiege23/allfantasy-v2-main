/**
 * Plain words for the tournament app's stored codes, so no screen prints `active`, `opening` or `snake` raw
 * (2026-11-24 tournament audit). Pure: the caller passes its own `t` from `useLanguage()`.
 */

type T = (key: string) => string

/** The three states a league's draft can be in, as the Drafts screen shows them. */
export type TournamentDraftState = 'scheduled' | 'live' | 'complete'

/**
 * A tournament league's draft state. `status` is the LEAGUE's phase, not the draft's: `active` is set when the
 * round starts after its drafts (lib/tournament/seasonRounds.ts), so an active league has already drafted.
 * Reading `active` as "scheduled" showed every Opening Round league as "SCHEDULED · TBD" in week 6.
 */
export function tournamentDraftState(draftStatus: string | null | undefined, leagueStatus: string | null | undefined): TournamentDraftState {
  const d = draftStatus ?? ''
  if (d === 'drafting' || d === 'in_progress' || d === 'live') return 'live'
  if (d === 'complete' || d === 'completed') return 'complete'
  if (d) return 'scheduled'
  const s = leagueStatus ?? ''
  if (s === 'drafting') return 'live'
  if (s === 'active' || s === 'complete' || s === 'completed' || s === 'archived') return 'complete'
  return 'scheduled'
}

export function draftStateWord(state: TournamentDraftState, t: T): string {
  return t(`tournament.words.draftState.${state}`)
}

/** `snake` → "Snake"; an unknown type keeps its own word, capitalised. */
export function draftTypeWord(type: string | null | undefined, t: T): string {
  const raw = String(type ?? '').toLowerCase()
  if (raw === 'snake' || raw === 'linear' || raw === 'auction') return t(`tournament.words.draftType.${raw}`)
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ') : ''
}

/** A round's or league's stored status in words: `active` → "In play", `upcoming` → "Coming up". */
export function tournamentStatusWord(status: string | null | undefined, t: T): string {
  const raw = String(status ?? '').toLowerCase()
  const known = ['active', 'upcoming', 'pending', 'complete', 'completed', 'drafting', 'forming', 'archived']
  if (known.includes(raw)) return t(`tournament.words.status.${raw === 'completed' ? 'complete' : raw}`)
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ') : ''
}

/** A standings row's advancement status in words: `qualified` → "Advancing", `wildcard_eligible` → "Wildcard". */
export function advancementWord(status: string | null | undefined, t: T): string {
  const raw = String(status ?? 'competing').toLowerCase()
  const key = raw === 'wildcard_eligible' ? 'wildcard' : raw
  if (['qualified', 'wildcard', 'bubble', 'competing', 'eliminated'].includes(key)) return t(`tournament.words.advancement.${key}`)
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ')
}

/** "Sat, Aug 29, 8:00 PM EDT" — a day and a minute, never seconds. */
export function formatDraftWhen(iso: string | Date, lang: string): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

/**
 * A stored UTC instant as the value of a `datetime-local` input, in the viewer's own clock — the clock the input
 * saves in (`new Date(value)` reads it as local). Slicing the ISO string showed UTC as local: an 8:00 PM ET draft
 * read "12:00 AM" the next day under a "Start (local)" label (2026-11-24 audit).
 */
export function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** "Oct 14, 9:00 AM" — for posts and announcements. */
export function formatPostedAt(iso: string | Date, lang: string): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
