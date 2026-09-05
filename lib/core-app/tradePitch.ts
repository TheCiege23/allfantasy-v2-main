import type { ManagerPresence, MoveKind, PresenceManager } from './managerPresence'
import { inWindow, windowLabel } from './managerActivityWindow'
import { platformLabel } from './platformLinks'

/**
 * The sentences on the trade-window card, composed from the presence loader's
 * output. Pure and client-safe; nothing here invents a figure.
 *
 * Two audiences: the LINE on the card ("@tashaR usually moves Sun 10a–12p ET
 * — They start Kincaid in Gridiron Gang. Send Pollard for Kincaid — values
 * are balanced. Pitch now, this is their window."), and the PITCH the Copy
 * button puts on the clipboard, written as a message to the other manager.
 *
 * ⚠ THEY/THEM FOR THE MANAGER. The handoff writes "he needs a TE" and "she
 * owns Kincaid"; a screen name tells us nothing about pronouns, and a wrong
 * guess beside someone's real name is worse than a neutral one.
 */

/** The package the trade visual recommended, when there is one. */
export type PitchPackage = { give: string[]; fairness: string } | null

export type PitchLine = {
  /** Bold: who, and when they move. */
  lead: string
  /** The rest: what they hold, the pitch, the timing. */
  body: string
  timing: 'now' | 'later' | 'unknown'
}

/** Last name, as the handoff prints it: "Kincaid". */
export function lastName(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name
}

/** Client-safe mirror of dash34's formatAgo (that module is server-only). */
export function agoLabel(ms: number): string {
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function moveVerb(kind: MoveKind): string {
  if (kind === 'trade') return 'traded'
  if (kind === 'waiver') return 'won a claim'
  return 'moved a player'
}

function needPhrase(m: PresenceManager): string | null {
  if (!m.need) return null
  const { level, position, held, starters } = m.need
  const word = level === 'thin' ? 'Thin' : level === 'set' ? 'Set' : 'Deep'
  return `${word} at ${position} (${held} for ${starters} slot${starters === 1 ? '' : 's'})`
}

function standingPhrase(m: PresenceManager): string | null {
  const parts = [m.record, m.rank != null ? `#${m.rank}` : null].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export function pitchLine(args: {
  presence: ManagerPresence
  manager: PresenceManager
  playerName: string
  now: Date
  pkg: PitchPackage
}): PitchLine {
  const { presence, manager: m, playerName, now, pkg } = args
  const last = lastName(playerName)
  const handle = `@${m.ownerName}`
  const platform = platformLabel(presence.platform)

  let lead: string
  let timing: PitchLine['timing'] = 'unknown'
  if (m.window) {
    lead = `${handle} usually moves ${windowLabel(m.window)}`
    timing = inWindow(m.window, now, presence.timeZone) ? 'now' : 'later'
  } else if (!presence.activityIngested) {
    lead = `${handle} — no ${platform} moves ingested yet`
  } else if (m.moves === 0) {
    lead = `${handle} hasn't made a move here`
  } else {
    lead = `${handle} moves at no set time`
  }

  const sentences: string[] = []
  if (m.role === 'owner') {
    const holds = m.startsHim === true ? `start ${last}` : m.startsHim === false ? `have ${last} on the bench` : `have ${last}`
    sentences.push(`They ${holds} in ${presence.leagueName}.`)
    sentences.push(pkg && pkg.give.length > 0 ? `Send ${pkg.give.join(' + ')} for ${last} — values are ${pkg.fairness}.` : 'Ask what it takes.')
  } else {
    const need = needPhrase(m)
    const standing = standingPhrase(m)
    const lede = [need, standing].filter(Boolean).join(', ')
    sentences.push(`${lede ? `${lede} — ` : ''}pitch ${last} there.`)
  }

  if (timing === 'now') sentences.push('Pitch now — this is their window.')
  else if (timing === 'later' && m.window) sentences.push(`Pitch ${windowLabel(m.window).replace(/ [A-Z]{2,4}$/, '')}, not now.`)
  else if (m.lastMove) sentences.push(`Last ${moveVerb(m.lastMove.kind)} ${agoLabel(now.getTime() - new Date(m.lastMove.at).getTime())}.`)

  return { lead, body: sentences.join(' '), timing }
}

/** What the Copy button puts on the clipboard — a message to the other manager. */
export function pitchText(args: { manager: PresenceManager; playerName: string; pkg: PitchPackage }): string {
  const { manager: m, playerName, pkg } = args
  if (m.role === 'owner') {
    if (pkg && pkg.give.length > 0) {
      return `Hey ${m.ownerName} — would you move ${playerName} for ${pkg.give.join(' + ')}? AllFantasy has the values ${pkg.fairness}. If there's a version of that you'd do, I'm listening.`
    }
    return `Hey ${m.ownerName} — what would it take to get ${playerName}? Open to picks or a swap at a spot you need.`
  }
  const need = m.need ? ` you look ${m.need.level} at ${m.need.position} —` : ''
  return `Hey ${m.ownerName} —${need} any interest in ${playerName}? Tell me what you'd move and I'll run it through AllFantasy.`
}

/** True when any listed manager moved inside the last day — the dot pulses. */
export function movedToday(presence: ManagerPresence, now: Date): boolean {
  const dayMs = 24 * 60 * 60 * 1000
  return presence.managers.some((m) => m.lastMove && now.getTime() - new Date(m.lastMove.at).getTime() < dayMs)
}
