/**
 * League health for a Survivor commissioner, as a row of torches: lit (fine), low (worth a look) or
 * out (needs the commissioner). Built from the Survivor commissioner dashboard
 * (`/api/leagues/[leagueId]/survivor/commissioner-dashboard`). Pure, so every rule is testable; the
 * words live in lib/core-app/messages/survivorIsland.ts so they translate.
 */
import type { RulebookConfig } from './survivorRulebook'

export type TorchState = 'lit' | 'low' | 'out'
export type HealthDetail =
  | { key: 'draftDone' | 'draftNone' | 'councilNone' | 'councilRead' | 'councilOpen' | 'autoRunning' | 'autoNeedsYou' | 'exileOpen' | 'exileReady' | 'exileUnlinked' }
  | { key: 'draftPicks' | 'seats'; n: number; of: number }
  | { key: 'claimed' | 'setupIssues' | 'channels'; n: number }
export type HealthTorch = { id: 'draft' | 'castaways' | 'council' | 'automation' | 'exile' | 'chat'; state: TorchState; detail: HealthDetail }

export type IslandTodoItem = { id: string; tone: 'action' | 'heads_up'; title: string; body: string; href: string; cta: string }

/** The slice of the dashboard this reads; every field may be missing on an older server. */
export type IslandControlFacts = {
  league?: { leagueSize?: number | null } | null
  shell?: { survivorChatChannels?: number; exileLeagueLinked?: boolean } | null
  operations?: {
    claimedManagers?: number
    draft?: { status?: string; picksMade?: number; totalPicks?: number } | null
    exileActive?: boolean
    automationNeedsAttention?: boolean
    readinessIssues?: string[]
  } | null
  council?: { status?: string; isRevealed?: boolean } | null
  config?: (RulebookConfig & { exileReturnEnabled?: boolean | null }) | null
  todo?: { headline?: string; items?: IslandTodoItem[] } | null
}

export function islandHealth(f: IslandControlFacts): HealthTorch[] {
  const ops = f.operations ?? {}
  const draft = ops.draft ?? null
  const size = f.league?.leagueSize ?? null
  const claimed = ops.claimedManagers ?? 0
  const status = (draft?.status ?? '').toLowerCase()
  const draftDone = status === 'completed' || status === 'complete'
  const issues = ops.readinessIssues?.length ?? 0
  const channels = f.shell?.survivorChatChannels ?? 0

  const torches: HealthTorch[] = [
    {
      id: 'draft',
      state: draftDone ? 'lit' : draft ? 'low' : 'out',
      detail: draftDone ? { key: 'draftDone' } : draft ? { key: 'draftPicks', n: draft.picksMade ?? 0, of: draft.totalPicks ?? 0 } : { key: 'draftNone' },
    },
    {
      id: 'castaways',
      state: size == null ? 'low' : claimed >= size ? 'lit' : claimed > 0 ? 'low' : 'out',
      detail: size == null ? { key: 'claimed', n: claimed } : { key: 'seats', n: claimed, of: size },
    },
    {
      id: 'council',
      state: !f.council || f.council.isRevealed ? 'lit' : 'low',
      detail: !f.council ? { key: 'councilNone' } : f.council.isRevealed ? { key: 'councilRead' } : { key: 'councilOpen' },
    },
    {
      id: 'automation',
      state: ops.automationNeedsAttention ? 'out' : issues > 0 ? 'low' : 'lit',
      detail: ops.automationNeedsAttention ? { key: 'autoNeedsYou' } : issues > 0 ? { key: 'setupIssues', n: issues } : { key: 'autoRunning' },
    },
  ]
  if (f.config?.exileReturnEnabled !== false) {
    torches.push({
      id: 'exile',
      state: f.shell?.exileLeagueLinked ? 'lit' : draftDone ? 'out' : 'low',
      detail: f.shell?.exileLeagueLinked ? { key: ops.exileActive ? 'exileOpen' : 'exileReady' } : { key: 'exileUnlinked' },
    })
  }
  torches.push({ id: 'chat', state: channels > 0 ? 'lit' : draftDone ? 'out' : 'low', detail: { key: 'channels', n: channels } })
  return torches
}

/** Action items first, then heads-ups, each group in the dashboard's own order. */
export function islandTodo(f: IslandControlFacts): IslandTodoItem[] {
  const items = f.todo?.items ?? []
  return [...items.filter((i) => i.tone === 'action'), ...items.filter((i) => i.tone !== 'action')]
}
