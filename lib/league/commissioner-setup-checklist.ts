import { countAssignedManagers } from './setup-readiness'

export type SetupStep = {
  id: string
  label: string
  detail: string
  done: boolean
  optional?: boolean
  action: string
  panel?: string
}
export type CommissionerSetupChecklist = {
  steps: SetupStep[]
  completed: number
  total: number
  ready: boolean
}

export function buildCommissionerSetupChecklist(input: {
  teamCount: number
  teams: Parameters<typeof countAssignedManagers>[0]
  rosterConfigured: boolean
  scoringConfigured: boolean
  rosterIds: readonly string[]
  draft: { draftType: string; rounds: number; slotOrder: unknown } | null
  draftDate: string | null
}): CommissionerSetupChecklist {
  const assigned = countAssignedManagers(input.teams)
  const open = Math.max(0, input.teamCount - assigned)
  const order = Array.isArray(input.draft?.slotOrder) ? input.draft.slotOrder : []
  const rows = order.filter((row): row is { slot: number; rosterId: string } =>
    row != null && typeof row === 'object' && Number.isInteger(row.slot)
    && row.slot >= 1 && row.slot <= input.teamCount
    && typeof row.rosterId === 'string' && row.rosterId.trim().length > 0)
  const rosterIds = new Set(input.rosterIds)
  const orderDone = input.teamCount > 0 && order.length === input.teamCount && rows.length === input.teamCount
    && new Set(rows.map(row => row.slot)).size === input.teamCount
    && new Set(rows.map(row => row.rosterId)).size === input.teamCount
    && rows.every(row => rosterIds.has(row.rosterId))
  const validDate = Boolean(input.draftDate && Number.isFinite(Date.parse(input.draftDate)))
  const steps: SetupStep[] = [
    { id: 'rules', label: 'Roster rules', done: input.rosterConfigured,
      detail: input.rosterConfigured ? 'Roster rules are saved. Review the defaults before drafting.' : 'Save your roster configuration.',
      action: 'Review roster rules', panel: 'roster' },
    { id: 'scoring', label: 'Scoring', done: input.scoringConfigured,
      detail: input.scoringConfigured ? 'Scoring settings are saved. Review the defaults before drafting.' : 'Save your scoring settings.',
      action: 'Review scoring', panel: 'scoring' },
    { id: 'managers', label: 'Invite managers', done: input.teamCount > 0 && assigned >= input.teamCount,
      detail: `${assigned}/${input.teamCount} managers assigned${open ? ` · ${open} open ${open === 1 ? 'slot' : 'slots'}` : ''}`,
      action: open ? 'Invite managers' : 'Manage members', panel: open ? 'invite' : 'members-commish' },
    { id: 'format', label: 'Draft format', done: Boolean(input.draft?.draftType.trim() && input.draft.rounds > 0),
      detail: input.draft ? `${input.draft.draftType} · ${input.draft.rounds} rounds` : 'Save a draft format and rounds.',
      action: 'Draft settings', panel: 'draft' },
    { id: 'order', label: 'Draft order', done: orderDone,
      detail: orderDone ? `${input.teamCount} unique draft slots saved.` : 'Set an order with one slot for every team.',
      action: 'Set draft order', panel: 'draft' },
    { id: 'date', label: 'Draft time', done: validDate, optional: true,
      detail: validDate ? `Scheduled: ${input.draftDate}` : 'Optional — schedule a time, or start manually from the draft room.',
      action: validDate ? 'Edit time' : 'Schedule draft', panel: 'draft' },
    { id: 'room', label: 'Draft room', done: Boolean(input.draft),
      detail: input.draft ? 'Your draft room is available to inspect before you start.' : 'Open the draft room to finish creating the draft.',
      action: 'Open draft room' },
  ]
  const required = steps.filter(step => !step.optional)
  const completed = required.filter(step => step.done).length
  return { steps, completed, total: required.length, ready: completed === required.length }
}
