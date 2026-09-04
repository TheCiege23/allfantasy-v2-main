import type { SearchClient } from './types'
import type { CommissionerSearchResultContract } from '../../contracts'
import { COMMISSIONER_ALL_NAV_ITEMS } from '../../navigation/moduleNav'
import { isLiveReady } from '../../liveReadiness'
import { liveRecommendationsClient } from '../../recommendations/decision-os-client/live'
import { liveManagerIntelligenceClient } from '../../managers/decision-os-client/live'
import { liveWorkspaceClient } from '../../workspace/decision-os-client/live'
import { liveAutomationClient } from '../../automations/decision-os-client/live'
import { liveReportsClient } from '../../reports/decision-os-client/live'
import { liveHelpClient } from '../../help/decision-os-client/live'
import { SETTINGS_RESULTS } from './settingsResults'

/**
 * Phase 3.12 — Search is the first module in this program confirmed as a
 * pure **composition layer**, not a Decision OS data consumer at all: its
 * own contract doc comment already says it "does not own" any of the
 * entities it indexes, only enough (`id`/`title`/`href`/`sourceModuleId`)
 * to find and navigate to them. There is nothing for Search itself to call
 * through `callDecisionOS` — `getIndex()` composes each source category by
 * calling that category's own already-audited *live* client
 * (`liveRecommendationsClient`, `liveManagerIntelligenceClient`,
 * `liveWorkspaceClient`, `liveAutomationClient`, `liveReportsClient`,
 * `liveHelpClient`), exactly mirroring `demo.ts`'s own composition over the
 * demo clients — never a second, parallel data path.
 *
 * Each composed category degrades **independently**, not all-or-nothing:
 * if a given client's `.data` is null (its own honest placeholder or
 * capability-gap state — true for all six today, since none of
 * Recommendations/Managers/Workspace/Automations/Reports/Help has closed
 * its own gap yet), that category simply contributes zero entries to the
 * index, via `.data ?? []`. This is the honest behavior, not the "Reports
 * lesson" trap (Phase 3.11): omitting a category doesn't assert "there are
 * zero recommendations/managers/tasks in your league," it only reflects
 * that this navigation aid cannot currently surface entries for that
 * category — the same experience a real search index gives for a corpus
 * that hasn't been indexed yet. Nothing here computes a ranking, score,
 * snippet, or count — every entry is a direct, untransformed projection of
 * a real `{id, title}` pair already produced by an already-audited module.
 *
 * `pages` (from `COMMISSIONER_ALL_NAV_ITEMS`) and `SETTINGS_RESULTS` carry
 * no backend dependency at all — static, product-defined navigation
 * content, safe to include identically in every mode, exactly as `demo.ts`
 * and `stub.ts` already do. Because of this, `getIndex()` *always*
 * succeeds once `isLiveReady('search')` is on: even in an environment
 * where every composed category is empty, a working command palette that
 * navigates to every page and settings section is a real, non-fabricated,
 * useful result — not a placeholder.
 *
 * No active-league resolution happens here: each composed client resolves
 * its own league internally (via the shared
 * `lib/commissioner-ui/resolveActiveLeagueId.ts`, Phase 3.11) if and when
 * it needs to. Search delegates, it never duplicates that resolution.
 */
function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'search' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

export const liveSearchClient: SearchClient = {
  async getIndex() {
    if (!(await isLiveReady('search'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const timestamp = new Date().toISOString()

    const pages: CommissionerSearchResultContract[] = COMMISSIONER_ALL_NAV_ITEMS.map((item) => ({
      id: `page-${item.id}`,
      category: 'page',
      title: item.label,
      href: item.href,
      sourceModuleId: item.id,
    }))

    const [recommendations, managers, tasks, automations, reportTemplates, helpArticles] = await Promise.all([
      liveRecommendationsClient.getQueue(),
      liveManagerIntelligenceClient.getManagerDirectory(),
      liveWorkspaceClient.getTasks(),
      liveAutomationClient.getCatalog(),
      liveReportsClient.getTemplates(),
      liveHelpClient.getArticles(),
    ])

    const recommendationResults: CommissionerSearchResultContract[] = (recommendations.data ?? []).map((rec) => ({
      id: `recommendation-${rec.id}`,
      category: 'recommendation',
      title: rec.title,
      href: '/commissioner-os/recommendations',
      sourceModuleId: rec.sourceModuleId,
    }))

    const managerResults: CommissionerSearchResultContract[] = (managers.data ?? []).map((manager) => ({
      id: `manager-${manager.id}`,
      category: 'manager',
      title: manager.managerName,
      href: '/commissioner-os/managers',
      sourceModuleId: 'managers',
    }))

    const taskResults: CommissionerSearchResultContract[] = (tasks.data ?? []).map((task) => ({
      id: `task-${task.id}`,
      category: 'task',
      title: task.title,
      href: '/commissioner-os/workspace',
      sourceModuleId: 'workspace',
    }))

    const automationResults: CommissionerSearchResultContract[] = (automations.data ?? []).map((automation) => ({
      id: `automation-${automation.id}`,
      category: 'automation',
      title: automation.name,
      href: '/commissioner-os/automations',
      sourceModuleId: 'automations',
    }))

    const reportResults: CommissionerSearchResultContract[] = (reportTemplates.data ?? []).map((template) => ({
      id: `report-${template.id}`,
      category: 'report',
      title: template.name,
      href: '/commissioner-os/reports',
      sourceModuleId: 'reports',
    }))

    const helpResults: CommissionerSearchResultContract[] = (helpArticles.data ?? []).map((article) => ({
      id: `help-${article.id}`,
      category: 'help',
      title: article.title,
      href: '/commissioner-os/help',
      sourceModuleId: 'help',
    }))

    return {
      data: [...pages, ...recommendationResults, ...managerResults, ...taskResults, ...automationResults, ...reportResults, ...SETTINGS_RESULTS, ...helpResults],
      error: null,
      source: 'live',
      timestamp,
    }
  },
}
