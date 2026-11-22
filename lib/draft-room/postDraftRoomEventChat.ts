/**
 * Draft-room chat cards for things that change the board WITHOUT a pick being made: an accepted
 * pick trade and a commissioner pick edit. Stored like pick cards (`source: 'draft'`, never in the
 * main league chat), as `type: 'draft_event'` with a `draftRoomEvent` payload the room draws as a
 * card. Fire-and-forget at every call site: a chat failure must never fail the trade or the edit.
 */

import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'

export const DRAFT_ROOM_EVENT_TYPE = 'draft_event'

export type DraftRoomEventKind = 'pick_trade' | 'commissioner_edit'

export type DraftRoomEventPayload = {
  kind: DraftRoomEventKind
  /** Short heading on the card, e.g. "Pick trade" or "Commissioner change". */
  title: string
  /** One plain sentence saying what happened. */
  detail: string
  /** Player the change is about, when there is one (drives the headshot). */
  playerName?: string | null
  position?: string | null
  team?: string | null
  headshotUrl?: string | null
  overall?: number | null
}

const ROUND = (r: number) => `Round ${r}`

/** "Gridiron Kings traded their Round 2 pick to Blitz Brigade for a Round 3 pick." */
export function describeDraftPickTrade(input: {
  proposerName: string
  receiverName: string
  giveRound: number
  receiveRound: number
}): DraftRoomEventPayload {
  const a = input.proposerName.trim() || 'A team'
  const b = input.receiverName.trim() || 'another team'
  return {
    kind: 'pick_trade',
    title: 'Pick trade',
    detail: `${a} sent their ${ROUND(input.giveRound)} pick to ${b} for a ${ROUND(input.receiveRound)} pick.`,
  }
}

export type CommissionerEditAction =
  | 'REMOVE_PLAYER_FROM_PICK'
  | 'REPLACE_PLAYER_ON_PICK'
  | 'ASSIGN_PLAYER_TO_PICK'
  | 'CHANGE_PICK_OWNER'

/** One sentence per commissioner action, naming the pick by its label so managers can find it. */
export function describeCommissionerPickEdit(input: {
  action: CommissionerEditAction
  pickLabel: string
  oldPlayerName?: string | null
  newPlayerName?: string | null
  oldOwnerName?: string | null
  newOwnerName?: string | null
}): DraftRoomEventPayload {
  const pick = `pick ${input.pickLabel}`
  const oldP = input.oldPlayerName?.trim() || null
  const newP = input.newPlayerName?.trim() || null
  let detail: string
  switch (input.action) {
    case 'REMOVE_PLAYER_FROM_PICK':
      detail = oldP ? `Removed ${oldP} from ${pick}.` : `Cleared ${pick}.`
      break
    case 'REPLACE_PLAYER_ON_PICK':
      detail = oldP && newP ? `Replaced ${oldP} with ${newP} at ${pick}.` : `Changed the player at ${pick}${newP ? ` to ${newP}` : ''}.`
      break
    case 'ASSIGN_PLAYER_TO_PICK':
      detail = newP ? `Put ${newP} at ${pick}${input.newOwnerName ? ` for ${input.newOwnerName}` : ''}.` : `Filled ${pick}.`
      break
    case 'CHANGE_PICK_OWNER':
      detail =
        input.newOwnerName
          ? `Moved ${pick} ${input.oldOwnerName ? `from ${input.oldOwnerName} ` : ''}to ${input.newOwnerName}.`
          : `Changed who owns ${pick}.`
      break
  }
  return {
    kind: 'commissioner_edit',
    title: 'Commissioner change',
    detail,
    playerName: input.action === 'REMOVE_PLAYER_FROM_PICK' ? oldP : newP,
  }
}

export async function postDraftRoomEventChat(input: {
  leagueId: string
  /** A real AppUser id (the commissioner who edited, the manager who accepted). */
  actorUserId: string
  event: DraftRoomEventPayload
  idempotencyKey?: string
}): Promise<void> {
  const e = input.event
  await createLeagueChatMessage(input.leagueId, input.actorUserId, `${e.title}: ${e.detail}`, {
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    type: DRAFT_ROOM_EVENT_TYPE,
    source: 'draft',
    metadata: {
      leagueChatSyncExcluded: true,
      draftRoomEvent: {
        kind: e.kind,
        title: e.title,
        detail: e.detail,
        ...(e.playerName ? { playerName: e.playerName } : {}),
        ...(e.position ? { position: e.position } : {}),
        ...(e.team ? { team: e.team } : {}),
        ...(e.headshotUrl ? { headshotUrl: e.headshotUrl } : {}),
        ...(e.overall != null ? { overall: e.overall } : {}),
        at: new Date().toISOString(),
      },
    },
  })
}
