/**
 * Alliance chats — pure rules. A castaway still in the game opens a private `alliance` channel with
 * chosen castaways who are also still in the game. Who may READ and POST afterwards is the existing
 * rule (lib/survivor/chatPermissionGuard.ts + survivorAccessControl.ts): members only, and a member
 * who is voted out or exiled can no longer post.
 *
 * Chimmy the host never joins an alliance: its host identities are refused as members. A seat Chimmy
 * PLAYS is a castaway like any other and may be invited; Chimmy never posts into an alliance.
 */
import type { SurvivorGovernanceSettings } from './survivorGovernanceSettings'

export const SURVIVOR_AI_HOST_USER_IDS: readonly string[] = ['survivor-ai-host', 'survivor-host-chimmy']
/** Open alliances one castaway may have created at once. */
export const SURVIVOR_ALLIANCES_PER_CASTAWAY = 5
export const SURVIVOR_ALLIANCE_NAME_MAX = 40

export interface AllianceCastaway {
  userId: string
  playerState: string
  tribeId: string | null
}

export interface AllianceRequestInput {
  settings: Pick<SurvivorGovernanceSettings, 'alliancesEnabled' | 'allianceMaxSize' | 'allianceSameTribeOnly'>
  creator: AllianceCastaway | null
  /** The castaways the creator named (not including the creator). */
  requestedUserIds: readonly string[]
  cast: readonly AllianceCastaway[]
  name: string
  merged: boolean
  /** Member sets of the creator's open alliances, to refuse an exact duplicate and cap the count. */
  existingMemberSets: ReadonlyArray<readonly string[]>
}

export type AllianceRequestResult =
  | { ok: true; name: string; memberUserIds: string[] }
  | { ok: false; code: 'disabled' | 'not_active' | 'bad_name' | 'bad_members' | 'too_big' | 'too_small' | 'cross_tribe' | 'duplicate' | 'too_many' | 'host'; error: string }

export function validateAllianceRequest(input: AllianceRequestInput): AllianceRequestResult {
  if (!input.settings.alliancesEnabled) return { ok: false, code: 'disabled', error: 'Alliance chats are turned off in this league.' }
  if (!input.creator || input.creator.playerState !== 'active') return { ok: false, code: 'not_active', error: 'Only castaways still in the game can form an alliance.' }
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > SURVIVOR_ALLIANCE_NAME_MAX) return { ok: false, code: 'bad_name', error: `Name the alliance (2–${SURVIVOR_ALLIANCE_NAME_MAX} characters).` }
  const requested = [...new Set(input.requestedUserIds.map((id) => id.trim()).filter(Boolean))].filter((id) => id !== input.creator!.userId)
  if (requested.some((id) => SURVIVOR_AI_HOST_USER_IDS.includes(id))) return { ok: false, code: 'host', error: 'Chimmy hosts the game and never joins an alliance.' }
  const members = requested.map((id) => input.cast.find((c) => c.userId === id))
  if (members.some((m) => !m || m.playerState !== 'active')) return { ok: false, code: 'bad_members', error: 'Everyone in an alliance must be a castaway still in the game.' }
  const size = requested.length + 1
  if (size < 2) return { ok: false, code: 'too_small', error: 'Invite at least one other castaway.' }
  if (size > input.settings.allianceMaxSize) return { ok: false, code: 'too_big', error: `An alliance holds at most ${input.settings.allianceMaxSize} castaways.` }
  if (input.settings.allianceSameTribeOnly && !input.merged && members.some((m) => m!.tribeId !== input.creator!.tribeId)) {
    return { ok: false, code: 'cross_tribe', error: 'Before the merge, alliances are within your own tribe in this league.' }
  }
  const memberUserIds = [input.creator.userId, ...requested]
  const key = [...memberUserIds].sort().join('|')
  if (input.existingMemberSets.some((set) => [...set].sort().join('|') === key)) return { ok: false, code: 'duplicate', error: 'You already have an alliance with exactly these castaways.' }
  if (input.existingMemberSets.length >= SURVIVOR_ALLIANCES_PER_CASTAWAY) return { ok: false, code: 'too_many', error: `You can run ${SURVIVOR_ALLIANCES_PER_CASTAWAY} alliances at once. Leave one first.` }
  return { ok: true, name, memberUserIds }
}
