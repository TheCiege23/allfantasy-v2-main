/**
 * IR AUTO-MOVE — when a player on a team's IR is activated, AllFantasy moves the player to the bench.
 *
 * Without it the app only suggested "Move X off IR", and an activated player who stays on IR keeps
 * the whole lineup unsaveable (an IR slot must hold an IR-eligible player) while scoring nothing.
 *
 * "ACTIVATED" IS THE LEAGUE'S OWN IR RULE, NOT A GUESS: a player whose current designation the league
 * no longer allows on IR (`isIrEligibleStatus`, the rule lineup validation enforces). The designation
 * comes from the live injury feed, and no live row means no designation — the same reading as the
 * lineup screen. ⚠ Because "no row" counts, a sport whose injury feed has no live rows at all is
 * skipped: an empty feed is an outage, not a league-wide recovery, and reading it as one would empty
 * every IR at once.
 *
 * The move is the manager's ordinary lineup save (source 'system'), so every rule it enforces still
 * applies: a full bench or roster refuses it, and the manager is told what to do instead. A player
 * whose game has started stays put until the next run.
 *
 * AF Commissioner: the commissioner switches it on (`League.settings.ir_auto_move`), and it runs only
 * while the league owner holds the plan.
 *
 * Pure.
 */
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { isIrEligibleStatus, type IrRules } from '@/lib/roster-lineup-engine/irEligibility'

export const IR_AUTO_MOVE_KEY = 'ir_auto_move'

export type IrAutoMoveRule = { enabled: boolean }

export function readIrAutoMoveEnabled(settings: unknown): boolean {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[IR_AUTO_MOVE_KEY] : null
  return Boolean(raw && typeof raw === 'object' && (raw as Record<string, unknown>).enabled === true)
}

/** Stored only in the shape the reader knows, so a malformed value can never read as on. */
export function parseIrAutoMoveRule(raw: unknown): { ok: true; value: IrAutoMoveRule } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).enabled !== 'boolean') {
    return { ok: false, error: 'Send { enabled: true } or { enabled: false }.' }
  }
  return { ok: true, value: { enabled: (raw as Record<string, unknown>).enabled === true } }
}

/** Player ids on the IR section of a saved lineup. */
export function irPlayerIds(playerData: unknown): string[] {
  return getNormalizedLineupSections(playerData).ir.map((r) => String(r.id ?? '').trim()).filter(Boolean)
}

/**
 * Who on IR the league's rule no longer allows there. `statusById` holds the live designation (null
 * for no live row); `feedLive` is false when the sport's feed has nothing live, which moves nobody.
 */
export function activatedIrPlayers(input: {
  irIds: readonly string[]
  statusById: ReadonlyMap<string, string | null>
  rules: IrRules
  feedLive: boolean
}): string[] {
  if (!input.feedLive) return []
  return input.irIds.filter((id) => !isIrEligibleStatus(input.rules, input.statusById.get(id) ?? null))
}

/** The lineup with these players moved from IR to the end of the bench, every other spot unchanged. */
export function moveOffIr(playerData: unknown, ids: readonly string[]): Record<string, unknown> {
  const move = new Set(ids)
  const sections = getNormalizedLineupSections(playerData)
  const leaving = sections.ir.filter((r) => move.has(String(r.id)))
  return buildPlayerDataFromSections(playerData, {
    ...sections,
    ir: sections.ir.filter((r) => !move.has(String(r.id))),
    bench: [...sections.bench, ...leaving],
  })
}

const list = (names: readonly string[], es: boolean) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${es ? 'y' : 'and'} ${names[names.length - 1]}`

/** The manager's notice, both languages. `moved` false: the save was refused, with its reason. */
export function irNotice(input: { names: readonly string[]; leagueName: string; moved: boolean; reason?: string | null }): {
  title: { en: string; es: string }
  body: { en: string; es: string }
} {
  const one = input.names.length === 1
  const who = { en: list(input.names, false), es: list(input.names, true) }
  const why = input.reason ? ` (${input.reason})` : ''
  if (input.moved) {
    return {
      title: { en: `${who.en} ${one ? 'is' : 'are'} off IR`, es: `${who.es} ${one ? 'salió' : 'salieron'} de la lista de lesionados` },
      body: {
        en: `${who.en} ${one ? 'was' : 'were'} activated, so AllFantasy moved them from IR to your ${input.leagueName} bench. Start them when you are ready.`,
        es: `${who.es} ya ${one ? 'está disponible' : 'están disponibles'}: AllFantasy hizo el cambio de la lista de lesionados a tu banca en ${input.leagueName}. Ya ${one ? 'puede' : 'pueden'} entrar en tu alineación.`,
      },
    }
  }
  return {
    title: { en: `${who.en} ${one ? 'is' : 'are'} active but still on IR`, es: `${who.es} ${one ? 'está disponible pero sigue' : 'están disponibles pero siguen'} en la lista de lesionados` },
    body: {
      en: `AllFantasy could not move ${who.en} to your ${input.leagueName} bench${why}. Make room, usually by dropping a player, then move them off IR.`,
      es: `AllFantasy no pudo pasar a ${who.es} a tu banca en ${input.leagueName}${why}. Haz espacio, normalmente soltando a un jugador, y luego saca ${one ? 'a ese jugador' : 'a esos jugadores'} de la lista de lesionados.`,
    },
  }
}
