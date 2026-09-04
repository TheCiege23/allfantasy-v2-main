import type { SearchClient } from './types'
import type { CommissionerSearchResultContract } from '../../contracts'
import { COMMISSIONER_ALL_NAV_ITEMS } from '../../navigation/moduleNav'

export const stubSearchClient: SearchClient = {
  async getIndex() {
    const pages: CommissionerSearchResultContract[] = COMMISSIONER_ALL_NAV_ITEMS.map((item) => ({
      id: `page-${item.id}`,
      category: 'page',
      title: item.label,
      href: item.href,
      sourceModuleId: item.id,
    }))

    const data: CommissionerSearchResultContract[] = [
      ...pages,
      { id: 'recommendation-stub-1', category: 'recommendation', title: 'Stub fixture recommendation', href: '/commissioner-os/recommendations', sourceModuleId: 'recommendations' },
      { id: 'manager-stub-1', category: 'manager', title: 'Stub Manager', href: '/commissioner-os/managers', sourceModuleId: 'managers' },
      { id: 'task-stub-1', category: 'task', title: 'Stub fixture task', href: '/commissioner-os/workspace', sourceModuleId: 'workspace' },
      { id: 'automation-stub-1', category: 'automation', title: 'Stub fixture automation', href: '/commissioner-os/automations', sourceModuleId: 'automations' },
      { id: 'report-stub-1', category: 'report', title: 'Stub fixture report', href: '/commissioner-os/reports', sourceModuleId: 'reports' },
      { id: 'setting-stub-1', category: 'setting', title: 'Stub fixture setting', href: '/commissioner-os/settings', sourceModuleId: 'settings' },
      { id: 'help-stub-1', category: 'help', title: 'Stub fixture help article', href: '/commissioner-os/help', sourceModuleId: 'help' },
    ]

    return {
      data,
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
