import type { CommissionerModuleId } from './navigation'

/**
 * A link back to the module whose evidence justified something — a task,
 * an automation, a recommendation. Promoted here after Automation Center
 * needed the exact same `{moduleId, label, href}` shape Workspace's
 * `CommissionerTaskRelatedLink` already defined privately; per the
 * Decision Ownership Matrix's "one owner, many consumers" rule, a shape
 * two independently-owned modules both need becomes a shared contract
 * rather than being duplicated or borrowed from one module's private
 * types by another.
 */
export interface CommissionerRelatedLink {
  moduleId: CommissionerModuleId
  label: string
  href: string
}
