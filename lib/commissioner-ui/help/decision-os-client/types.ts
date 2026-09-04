import type { CommissionerPlatformResponse, CommissionerHelpArticleContract, CommissionerGlossaryTermContract } from '../../contracts'

/**
 * Help & Knowledge Center owns explanatory content only — per the approved
 * blueprint (lib/commissioner-ui/help/BLUEPRINT.md §4), two flat
 * list-getters, no `getSummary()`. Mission Control consumes an entry
 * point only (the shared header's HelpCircle link, §8), never a summary
 * method — there is no meaningful daily-decision count for help content
 * the way "2 critical risks" is meaningful for League Health.
 */
export interface HelpClient {
  getArticles(): Promise<CommissionerPlatformResponse<CommissionerHelpArticleContract[]>>
  getGlossary(): Promise<CommissionerPlatformResponse<CommissionerGlossaryTermContract[]>>
}
