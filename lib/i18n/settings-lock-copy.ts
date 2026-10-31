/**
 * English + Spanish copy for the settings lock panel (components/league-settings/home/SettingsLockPanel.tsx),
 * shown on the league settings home and the Commissioner Settings Permissions tab. Kept beside
 * `lib/i18n/translations`, like c2c-campus-copy.ts; anything that is not Spanish reads English.
 * `{{n}}`-style placeholders are filled by `lockCopy`. The area names are the panel's own, so the
 * server-side LOCK_GROUP_LABELS (used in chat polls) stay as they are.
 */
import type { LockGroup } from '@/lib/league/settingsLock'

export type LockLang = 'en' | 'es'

export function lockLang(language: string | null | undefined): LockLang {
  return String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const LOCK_AREA_COPY: Record<LockGroup, Record<LockLang, { label: string; help: string }>> = {
  scoring: {
    en: { label: 'Scoring', help: 'Scoring rules, presets and the median game' },
    es: { label: 'Puntuación', help: 'Reglas de puntuación, ajustes predefinidos y el partido contra la mediana' },
  },
  rosters: {
    en: { label: 'Rosters', help: 'Roster size, starting lineup, bench, IR and taxi' },
    es: { label: 'Plantillas', help: 'Tamaño de plantilla, alineación titular, banca, lesionados y escuadra taxi' },
  },
  keepers: {
    en: { label: 'Keepers', help: 'Keeper count, costs and deadlines' },
    es: { label: 'Jugadores conservados', help: 'Cantidad de conservados, costos y fechas límite' },
  },
  trades: {
    en: { label: 'Trades', help: 'Trade deadline, review and pick trading' },
    es: { label: 'Intercambios', help: 'Fecha límite, revisión e intercambio de selecciones' },
  },
  waivers: {
    en: { label: 'Waivers', help: 'Waiver type, FAAB budget, bids and schedule' },
    es: { label: 'Agentes libres', help: 'Tipo de reclamación, presupuesto FAAB, ofertas y calendario' },
  },
  playoffs: {
    en: { label: 'Playoffs', help: 'Playoff teams, start week, byes and bracket' },
    es: { label: 'Playoffs', help: 'Equipos en playoffs, semana de inicio, descansos y cuadro' },
  },
}

export const LOCK_COPY = {
  loading: { en: 'Loading the settings lock…', es: 'Cargando el bloqueo de ajustes…' },
  loadFailed: { en: 'Could not load the settings lock.', es: 'No se pudo cargar el bloqueo de ajustes.' },
  offline: { en: 'Could not reach the server. Try again.', es: 'No se pudo conectar con el servidor. Inténtalo de nuevo.' },
  saveFailed: { en: 'That didn’t save. Try again.', es: 'No se guardó. Inténtalo de nuevo.' },
  intro: {
    en: 'Lock any area of your rules for the {{season}} season. Nobody can change a locked area — commissioners included —',
    es: 'Bloquea cualquier área de tus reglas para la temporada {{season}}. Nadie puede cambiar un área bloqueada, ni siquiera los comisionados,',
  },
  currentSeason: { en: 'current', es: 'actual' },
  introUnderway: {
    en: ' and with the season under way it only unlocks if the league votes for it, in league chat. A yes vote opens it for 72 hours.',
    es: ' y con la temporada en curso solo se desbloquea si la liga lo vota en el chat de la liga. Un voto a favor la abre durante 72 horas.',
  },
  introBefore: {
    en: ' and once your draft starts it only unlocks if the league votes for it. Until then you can unlock it yourself.',
    es: ' y cuando empiece tu draft solo se desbloquea si la liga lo vota. Hasta entonces puedes desbloquearla tú mismo.',
  },
  lockAria: { en: 'Lock {{area}} for the season', es: 'Bloquear {{area}} durante la temporada' },
  locked: { en: 'Locked', es: 'Bloqueado' },
  open: { en: 'Open', es: 'Abierto' },
  lockedDone: { en: '{{area}} locked for the season.', es: '{{area}}: bloqueado durante la temporada.' },
  unlockedDone: { en: '{{area}} unlocked.', es: '{{area}}: desbloqueado.' },
  unlockedUntil: { en: 'Unlocked by league vote until {{when}}.', es: 'Desbloqueado por votación de la liga hasta el {{when}}.' },
  voteOpenRow: { en: 'League vote open until {{when}} — vote in league chat.', es: 'Votación de la liga abierta hasta el {{when}}: vota en el chat de la liga.' },
  askUnlock: { en: 'Ask the league to unlock', es: 'Pedir a la liga que lo desbloquee' },
  unlockQuestion: { en: 'Unlock {{area}}?', es: '¿Desbloquear {{area}}?' },
  voteDays: { en: 'Voting stays open for', es: 'La votación sigue abierta durante' },
  day: { en: '{{n}} day', es: '{{n}} día' },
  days: { en: '{{n}} days', es: '{{n}} días' },
  reason: { en: 'Why (shows in league chat, optional)', es: 'Motivo (aparece en el chat de la liga, opcional)' },
  posting: { en: 'Posting…', es: 'Publicando…' },
  postVote: { en: 'Post the vote', es: 'Publicar la votación' },
  cancel: { en: 'Cancel', es: 'Cancelar' },
  votePosted: {
    en: 'Vote posted to league chat. A majority of votes cast unlocks it.',
    es: 'Votación publicada en el chat de la liga. La mayoría de los votos emitidos la desbloquea.',
  },
  votesThisSeason: { en: 'Votes this season', es: 'Votaciones de esta temporada' },
  voteOpen: { en: '{{area}}: vote open until {{when}}', es: '{{area}}: votación abierta hasta el {{when}}' },
  votePassed: { en: '{{area}}: unlocked by vote', es: '{{area}}: desbloqueado por votación' },
  voteFailed: { en: '{{area}}: stayed locked', es: '{{area}}: siguió bloqueado' },
  tally: { en: ' ({{yes}} yes, {{no}} no)', es: ' ({{yes}} a favor, {{no}} en contra)' },
  // The settings-lock route's refusal codes (app/api/commissioner/leagues/[leagueId]/settings-lock).
  err_vote_required: {
    en: 'The season is under way, so that area can only be unlocked by a league vote.',
    es: 'La temporada está en curso, así que esa área solo se puede desbloquear con una votación de la liga.',
  },
  err_not_locked: { en: 'That area is not locked right now.', es: 'Esa área no está bloqueada ahora.' },
  err_already_voting: { en: 'A vote to unlock that area is already open.', es: 'Ya hay una votación abierta para desbloquear esa área.' },
  err_bad_days: { en: 'Voting can stay open for 1, 2, 3, 5 or 7 days.', es: 'La votación puede durar 1, 2, 3, 5 o 7 días.' },
  err_poll_failed: {
    en: 'The vote could not be posted to league chat. Try again.',
    es: 'No se pudo publicar la votación en el chat de la liga. Inténtalo de nuevo.',
  },
} as const satisfies Record<string, Record<LockLang, string>>

export type LockCopyKey = keyof typeof LOCK_COPY

export function lockCopy(lang: LockLang, key: LockCopyKey, vars: Record<string, string | number> = {}): string {
  return LOCK_COPY[key][lang].replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''))
}

/** The copy for a refusal code the route sends, or null for one this panel does not know. */
export function lockErrorCopy(lang: LockLang, code: unknown): string | null {
  const key = `err_${String(code ?? '')}`
  return Object.hasOwn(LOCK_COPY, key) ? lockCopy(lang, key as LockCopyKey) : null
}
