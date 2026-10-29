/**
 * ASK CHIMMY AS COMMISSIONER — what is on the commissioner's desk, for the Commissioner Hub's
 * "Ask Chimmy" (lib/ai-commissioner/AICommissionerService.ts `answerAICommissionerQuestion`).
 *
 * Before this, that answer saw only the weekly recap, matchups, waivers, draft notes and flagged
 * trades. The commissioner's own work was invisible to it: a stat correction waiting to be applied,
 * a trade in their review, inactive teams, unpaid dues, a season waiting to be renewed. So "what
 * needs my attention?" was answered from a recap.
 *
 * The desk is read from what the Hub already shows, never from anything new:
 *   open tasks   the Commissioner Workspace detectors (lib/commissioner-workspace/taskSources.ts)
 *   this week    the weekly checklist's to-do items (lib/commissioner/weeklyChecklist.ts)
 *   the office   the league office slice, commissioner view (lib/chimmy-context/leagueOfficeSummary.ts)
 *
 * ACTIONS ARE LINKS FROM THAT LIST, NEVER FROM THE MODEL. Chimmy can say what to do; the buttons
 * under the answer come only from tasks the detectors filed, so a link can never be invented, and
 * nothing here changes the league — the commissioner acts on the screen it opens.
 *
 * The functions below are pure; `readCommissionerDesk` does the reads.
 */

export type DeskAction = { label: string; href: string; priority: 'critical' | 'elevated' | 'standard' | 'advisory' }
export type DeskTask = { title: string; description: string; action: DeskAction | null }

export type CommissionerDesk = {
  /** The league office in prose, commissioner view; null when there is nothing in it. */
  office: string | null
  tasks: DeskTask[]
}

const PRIORITY_RANK: Record<DeskAction['priority'], number> = { critical: 0, elevated: 1, standard: 2, advisory: 3 }

/** A question and a task are about the same thing when both use a word from one of these. */
const TOPICS: string[][] = [
  ['trade', 'trades', 'veto', 'review', 'intercambio', 'intercambios'],
  ['waiver', 'waivers', 'claim', 'claims', 'faab', 'reclamo', 'reclamos'],
  ['lineup', 'lineups', 'starter', 'starters', 'bench', 'alineación', 'alineaciones'],
  ['inactive', 'absent', 'away', 'ghost', 'inactivo', 'inactivos'],
  ['correction', 'corrections', 'stat', 'stats', 'corrección', 'correcciones'],
  ['dues', 'payout', 'payouts', 'prize', 'prizes', 'money', 'paid', 'pay', 'buy-in', 'cuota', 'pagos', 'premio'],
  ['renew', 'renewal', 'rollover', 'offseason', 'temporada', 'renovar'],
  ['orphan', 'orphaned', 'manager', 'managers', 'replace', 'huérfano', 'mánager'],
  ['score', 'scores', 'final', 'standings', 'clasificación'],
]

/** "What needs my attention?" and its kin: every open task is relevant. */
const GENERAL = /\b(attention|to ?do|todo|what should i|anything|priorit|this week|today|pending|open (items|tasks)|pendiente|atención|qué (debo|tengo))/i

const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean))

function topicScore(question: Set<string>, text: Set<string>): number {
  let score = 0
  for (const group of TOPICS) if (group.some((w) => question.has(w)) && group.some((w) => text.has(w))) score++
  return score
}

/**
 * The tasks a question is about, most relevant first, then most urgent. A question that names a
 * topic gets only that topic's tasks, even worded generally ("anything on trades?"); a general
 * question that names none ("what needs my attention?") gets every task by urgency. Anything else
 * gets none — the answer then stays on what was asked.
 */
export function relevantDeskTasks(question: string, tasks: readonly DeskTask[], limit = 3): DeskTask[] {
  const q = words(question)
  const scored = tasks.map((task, i) => ({ task, i, score: topicScore(q, words(`${task.title} ${task.description}`)) }))
  const onTopic = scored.some((x) => x.score > 0)
  const general = !onTopic && GENERAL.test(question)
  return scored
    .filter((x) => general || x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        PRIORITY_RANK[a.task.action?.priority ?? 'advisory'] - PRIORITY_RANK[b.task.action?.priority ?? 'advisory'] ||
        a.i - b.i,
    )
    .slice(0, limit)
    .map((x) => x.task)
}

/** Links under the answer: one per relevant task that has a screen, never the same screen twice. */
export function deskActions(tasks: readonly DeskTask[]): DeskAction[] {
  const seen = new Set<string>()
  const out: DeskAction[] = []
  for (const t of tasks) {
    if (!t.action || seen.has(t.action.href)) continue
    seen.add(t.action.href)
    out.push(t.action)
  }
  return out
}

/** The deterministic answer when the model is unavailable: the matching tasks, in plain words. */
export function deskAnswer(tasks: readonly DeskTask[]): string | null {
  if (tasks.length === 0) return null
  return ['On your desk:', ...tasks.map((t) => `- ${t.title}: ${t.description}`)].join('\n')
}

/** Stable text of the desk, so a cached answer is never served after the desk has changed. */
export function deskFingerprint(desk: CommissionerDesk | null | undefined): string {
  if (!desk) return ''
  return [desk.office ?? '', ...desk.tasks.map((t) => t.title)].join('\n')
}

type TaskCandidate = {
  title: string
  description: string
  priority: DeskAction['priority']
  relatedLinks: Array<{ label: string; href: string }>
}
type ChecklistTodo = { status: string; title: { en: string }; detail: { en: string }; href: string }

/** Tasks first (they are filed and tracked), then this week's checklist to-dos the tasks do not repeat. */
export function buildDeskTasks(tasks: readonly TaskCandidate[], checklist: readonly ChecklistTodo[]): DeskTask[] {
  const out: DeskTask[] = tasks.map((t) => ({
    title: t.title,
    description: t.description,
    action: t.relatedLinks[0] ? { label: t.relatedLinks[0].label, href: t.relatedLinks[0].href, priority: t.priority } : null,
  }))
  const hrefs = new Set(out.map((t) => t.action?.href).filter(Boolean))
  for (const item of checklist) {
    if (item.status !== 'todo' || hrefs.has(item.href)) continue
    out.push({ title: item.title.en, description: item.detail.en, action: { label: item.title.en, href: item.href, priority: 'standard' } })
  }
  return out
}

/**
 * The desk for one league and commissioner. Each source fails on its own: a desk with one part
 * missing is still more than the recap alone, and the answer never claims a source it lacked.
 */
export async function readCommissionerDesk(leagueId: string, userId: string, now = new Date()): Promise<CommissionerDesk> {
  const [{ detectLeagueTasks }, { readWeeklyChecklist }, { LeagueOfficeContextProvider }] = await Promise.all([
    import('@/lib/commissioner-workspace/taskSources'),
    import('@/lib/commissioner/weeklyChecklistService'),
    import('@/lib/chimmy-context/providers/LeagueOfficeContextProvider'),
  ])
  const [tasks, checklist, office] = await Promise.all([
    detectLeagueTasks(leagueId, now).catch(() => []),
    readWeeklyChecklist(leagueId, now).catch(() => null),
    new LeagueOfficeContextProvider().load({ userId, leagueId }).catch(() => null),
  ])
  return {
    office: office?.ok ? office.data?.summary ?? null : null,
    tasks: buildDeskTasks(tasks, checklist?.applies ? checklist.items : []),
  }
}
