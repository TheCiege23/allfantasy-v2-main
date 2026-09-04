import type { SearchClient } from './types'
import type { CommissionerSearchResultContract } from '../../contracts'
import { COMMISSIONER_ALL_NAV_ITEMS } from '../../navigation/moduleNav'
import { demoRecommendationsClient } from '../../recommendations/decision-os-client/demo'
import { demoManagerIntelligenceClient } from '../../managers/decision-os-client/demo'
import { demoWorkspaceClient } from '../../workspace/decision-os-client/demo'
import { demoAutomationClient } from '../../automations/decision-os-client/demo'
import { demoReportsClient } from '../../reports/decision-os-client/demo'
import { demoHelpClient } from '../../help/decision-os-client/demo'
import { SETTINGS_RESULTS } from './settingsResults'

function ts() {
  return new Date().toISOString()
}

/**
 * "Iron Horse Dynasty" cross-module index, for real — every non-page,
 * non-setting entry below is produced by awaiting that category's own
 * demo client and projecting only {id, title}. This file holds no
 * second copy of any recommendation's rationale, any task's
 * description, any manager's archetype, or any report's summary; it
 * only ever reads the title back out of the module that already owns
 * the data, exactly the "reference existing entities, never duplicate
 * them" requirement this phase was built under.
 */
export const demoSearchClient: SearchClient = {
  async getIndex() {
    const [recommendations, managers, tasks, automations, reportTemplates, helpArticles] = await Promise.all([
      demoRecommendationsClient.getQueue(),
      demoManagerIntelligenceClient.getManagerDirectory(),
      demoWorkspaceClient.getTasks(),
      demoAutomationClient.getCatalog(),
      demoReportsClient.getTemplates(),
      demoHelpClient.getArticles(),
    ])

    const pages: CommissionerSearchResultContract[] = COMMISSIONER_ALL_NAV_ITEMS.map((item) => ({
      id: `page-${item.id}`,
      category: 'page',
      title: item.label,
      href: item.href,
      sourceModuleId: item.id,
    }))

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
      source: 'demo',
      timestamp: ts(),
    }
  },
}
