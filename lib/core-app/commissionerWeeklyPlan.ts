import type { WeeklyBlueprint } from './weeklyBlueprint'
import { weeklyActionText } from './weeklyBlueprint'
import { buildWeeklySwings } from './weeklySportPlan'

/** Unsent, explicitly reviewed league-chat content. Never carry it across leagues. */
export type ReviewedLeagueDraft = {
  id: string
  leagueId: string
  text: string
  poll?: { question: string; options: string[]; closeAt: string; allowMultiple: boolean }
}

export function weeklyTaskSuggestions(data: WeeklyBlueprint, leagueId: string, es = false) {
  return data.actions.filter(a => a.leagueId === leagueId).map(a => ({
    id: a.id,
    title: weeklyActionText(a, es),
    description: `${buildWeeklySwings(data,es).find(s=>s.id===a.id)?.detail ?? ''}\n${a.leagueName}${a.period ? ` · ${es ? 'Período' : 'Period'} ${a.period}` : ''}\n${es ? 'Revisar los datos actuales y coordinar el seguimiento con el manager.' : 'Review current evidence and coordinate follow-up with the manager.'}`,
  }))
}

export function validateWeeklyTask(body: Record<string, unknown>) {
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestId) ||
      typeof body.title !== 'string' || !body.title.trim() || body.title.length > 180 ||
      typeof body.description !== 'string' || body.description.length > 4000 ||
      (body.dueAt != null && (typeof body.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.dueAt) || !Number.isFinite(Date.parse(body.dueAt))))) return null
  if (body.issueId != null && (typeof body.issueId !== 'string' || !/^[a-zA-Z0-9:-]{1,120}$/.test(body.issueId))) return null
  return { issueId: typeof body.issueId === 'string' ? body.issueId : null, requestId: body.requestId, title: body.title.trim(), description: body.description.trim(), dueAt: body.dueAt ? new Date(body.dueAt as string) : null }
}

export function reviewedPoll(question: string, options: string[], closeAt: string, now = Date.now()) {
  const choices = options.map(s => s.trim()).filter(Boolean)
  const at = new Date(closeAt).getTime()
  if (!question.trim() || question.length > 240 || choices.length < 2 || choices.length > 6 ||
      choices.some(s => s.length > 100) || new Set(choices.map(s => s.toLowerCase())).size !== choices.length ||
      !Number.isFinite(at) || at <= now) return null
  return { question: question.trim(), options: choices, closeAt: new Date(at).toISOString(), allowMultiple: false }
}
