/**
 * Readable labels and values for Draft HQ's archived records (2026-10-07).
 *
 * The archive's five record sections — draft-time snapshot, clock timeline, commissioner corrections,
 * trade packages and trades executed during the draft — printed `JSON.stringify(data, null, 2)` in a
 * <pre>: a 4,900-character dump of raw platform settings (`slots_bn`, `autopause_enabled`…) on a live
 * dynasty league, and a bare `[]` for an empty section. Nobody managing a league should read JSON.
 *
 * The records are typed `unknown` in `ArchiveDetail` and their shape differs between native and
 * imported drafts, so this does not assume a shape: KNOWN field names get an English and Spanish
 * label, anything else gets a tidied version of its own name, and every field is still shown — the
 * view is lossless, it only stops being JSON.
 *
 * PURE and client-safe.
 */

const LABELS: Record<string, [string, string]> = {
  // Snapshot — imported drafts (provider settings) and native drafts (rules)
  format: ['Format', 'Formato'],
  status: ['Status', 'Estado'],
  sport: ['Sport', 'Deporte'],
  name: ['Name', 'Nombre'],
  draftSettings: ['Draft settings', 'Configuración del draft'],
  draftOrder: ['Draft order', 'Orden del draft'],
  observedSeasonScoring: ['Season scoring (observed)', 'Puntuación de la temporada (observada)'],
  observedSeasonRosterPositions: ['Roster positions (observed)', 'Posiciones de la plantilla (observadas)'],
  tradeCoverage: ['Trade coverage', 'Cobertura de intercambios'],
  tradedPicks: ['Traded picks', 'Selecciones intercambiadas'],
  startTime: ['Started', 'Inicio'],
  lastPickedTime: ['Last pick', 'Última selección'],
  slotToRosterId: ['Draft slot → team', 'Puesto del draft → equipo'],
  teams: ['Teams', 'Equipos'],
  rosterId: ['Team ID', 'ID del equipo'],
  teamName: ['Team name', 'Nombre del equipo'],
  season: ['Season', 'Temporada'],
  round: ['Round', 'Ronda'],
  previousOwnerId: ['Previous owner', 'Dueño anterior'],
  ownerId: ['Owner', 'Dueño'],
  context: ['Context', 'Contexto'],
  capturedAt: ['Captured', 'Capturado'],
  externalId: ['Team ID', 'ID del equipo'],
  rules: ['Rules', 'Reglas'],
  draftType: ['Draft type', 'Tipo de draft'],
  rounds: ['Rounds', 'Rondas'],
  teamCount: ['Teams', 'Equipos'],
  timerSeconds: ['Pick timer', 'Tiempo por selección'],
  thirdRoundReversal: ['Third-round reversal', 'Inversión en la 3.ª ronda'],
  // Sleeper draft settings
  pick_timer: ['Pick timer', 'Tiempo por selección'],
  reversal_round: ['Reversal round', 'Ronda de inversión'],
  cpu_autopick: ['Auto-pick for an absent manager', 'Selección automática si el mánager no está'],
  autostart: ['Starts automatically', 'Empieza automáticamente'],
  alpha_sort: ['Players listed alphabetically', 'Jugadores en orden alfabético'],
  nomination_timer: ['Nomination timer', 'Tiempo de nominación'],
  player_type: ['Player pool', 'Grupo de jugadores'],
  autopause_enabled: ['Overnight auto-pause', 'Pausa nocturna automática'],
  autopause_start_time: ['Auto-pause starts', 'Inicio de la pausa automática'],
  autopause_end_time: ['Auto-pause ends', 'Fin de la pausa automática'],
  // Clock timeline (native)
  at: ['Time', 'Hora'],
  event: ['Event', 'Evento'],
  clock: ['Clock', 'Reloj'],
  allowanceSeconds: ['Time allowed', 'Tiempo permitido'],
  nomination: ['Nomination', 'Nominación'],
  bidderRosterId: ['Bidding team', 'Equipo que puja'],
  amount: ['Amount', 'Cantidad'],
  ownershipChanges: ['Ownership changes', 'Cambios de dueño'],
  selection: ['Selection', 'Selección'],
  overall: ['Overall pick', 'Selección global'],
  playerId: ['Player ID', 'ID del jugador'],
  playerName: ['Player', 'Jugador'],
  position: ['Position', 'Posición'],
  team: ['Team', 'Equipo'],
  displayName: ['Manager', 'Mánager'],
  // Trade packages
  id: ['ID', 'ID'],
  transactionId: ['Transaction', 'Transacción'],
  week: ['Week', 'Semana'],
  adds: ['Added', 'Altas'],
  drops: ['Dropped', 'Bajas'],
  draftPicks: ['Draft picks', 'Selecciones del draft'],
  rosterIds: ['Teams involved', 'Equipos implicados'],
  providerCreatedAt: ['Proposed', 'Propuesto'],
  providerStatusUpdatedAt: ['Completed', 'Completado'],
  proposerRosterId: ['Proposing team', 'Equipo que propone'],
  receiverRosterId: ['Receiving team', 'Equipo que recibe'],
  proposerName: ['Proposed by', 'Propuesto por'],
  receiverName: ['Accepted by', 'Aceptado por'],
  give: ['Gave', 'Entregó'],
  receive: ['Received', 'Recibió'],
  slot: ['Slot', 'Puesto'],
  originalRosterId: ['Original team', 'Equipo original'],
  acceptedAt: ['Accepted', 'Aceptado'],
  // Trades executed during the draft
  tradeId: ['Trade', 'Intercambio'],
  executedAt: ['Executed', 'Ejecutado'],
  reversedAt: ['Reversed', 'Revertido'],
  completeness: ['Completeness', 'Integridad'],
  recordedAssetCount: ['Assets recorded', 'Activos registrados'],
  assets: ['Assets', 'Activos'],
  assetType: ['Asset type', 'Tipo de activo'],
  itemReference: ['Reference', 'Referencia'],
  faabAmount: ['FAAB', 'FAAB'],
  fromRosterId: ['From team', 'Del equipo'],
  toRosterId: ['To team', 'Al equipo'],
  pickSeason: ['Pick season', 'Temporada de la selección'],
  pickRound: ['Pick round', 'Ronda de la selección'],
  pickNumber: ['Pick number', 'Número de selección'],
}

/** Settings that are a 0/1 switch on the provider, read as yes/no. */
const SWITCHES = new Set(['cpu_autopick', 'autostart', 'alpha_sort', 'autopause_enabled', 'thirdRoundReversal'])
/** A number of seconds. */
const SECONDS = new Set(['pick_timer', 'timerSeconds', 'allowanceSeconds', 'nomination_timer'])
/** A provider time in epoch milliseconds, or an ISO string. */
const TIMES = new Set(['startTime', 'lastPickedTime', 'providerCreatedAt', 'providerStatusUpdatedAt', 'capturedAt', 'at', 'acceptedAt', 'executedAt', 'reversedAt'])

/** "slots_super_flex" → "SUPER FLEX" — the position part of a lineup-slot setting. */
export function slotName(key: string): string {
  return key.replace(/^slots_/, '').replace(/_/g, ' ').toUpperCase()
}

/** Lineup order: starters as a lineup reads them, then bench, IR and taxi last. Unknown slots sit before the bench. */
const SLOT_ORDER = ['qb', 'rb', 'wr', 'te', 'flex', 'wrrb_flex', 'rec_flex', 'super_flex', 'k', 'def', 'dl', 'lb', 'db', 'idp_flex', 'bn', 'reserve', 'ir', 'taxi']

export function slotRank(key: string): number {
  const slot = key.replace(/^slots_/, '')
  const i = SLOT_ORDER.indexOf(slot)
  return i === -1 ? SLOT_ORDER.indexOf('bn') - 0.5 : i
}

/** A field's label in the reader's language; an unknown field gets its own name, tidied. */
export function recordLabel(key: string, language: string): string {
  const known = LABELS[key]
  if (known) return language === 'es' ? known[1] : known[0]
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

/** "24 h", "1 h 30 min", "45 s" — the language-neutral short units. */
export function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) return String(total)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.round(total % 60)
  const parts = [h ? `${h} h` : '', m ? `${m} min` : '', !h && !m ? `${s} s` : s ? `${s} s` : '']
  return parts.filter(Boolean).join(' ')
}

/** "2026-08-30 19:05 UTC" from an ISO string or epoch milliseconds; null when it is neither. */
export function formatTime(value: unknown): string | null {
  const ms = typeof value === 'number' && value > 1e11 ? value : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

/** A primitive value, formatted for its field. */
export function formatRecordValue(key: string, value: unknown, language: string): string {
  const es = language === 'es'
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? (es ? 'Sí' : 'Yes') : 'No'
  if (SWITCHES.has(key) && (value === 0 || value === 1)) return value === 1 ? (es ? 'Sí' : 'Yes') : 'No'
  if (SECONDS.has(key) && typeof value === 'number') return formatSeconds(value)
  if (TIMES.has(key) || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))) {
    const t = formatTime(value)
    if (t) return t
  }
  return String(value)
}
