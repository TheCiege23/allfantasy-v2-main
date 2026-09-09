import type { HelpClient } from './types'
import { CATALOG_REVISED_AT, HELP_ARTICLES, HELP_GLOSSARY } from '../helpCatalog'

/**
 * Help & Knowledge Center, live.
 *
 * 🛑 THIS RETURNED `upstream_unavailable` FOR BOTH METHODS, AND THE REASONING WAS BETTER THAN THE
 * RESULT. The argument — recorded here before this change and worth restating rather than deleting
 * — was that `source: 'live'` should mean one consistent thing across all twelve adapter
 * namespaces, and that Help Center's unusually static content should not get to quietly redefine
 * what "live" promises. Serving the demo catalog under a live label looked like exactly that.
 *
 * What it produced instead: a commissioner who has just started paying opens Help and is told the
 * backend is not integrated, while the twelve articles explaining the product sit in a file only
 * Demo Mode can reach. The consistency was preserved at the cost of the only thing the module is
 * for.
 *
 * The resolution is that Help is not like the other eleven, and the honest way to say so is a
 * revision date rather than an error. Every other namespace answers a question about YOUR league,
 * and needs a backend to do it. Help answers questions about the PRODUCT, and that content ships
 * inside the deployment — there is no upstream that could be unavailable. `CATALOG_REVISED_AT`
 * carries when the prose was authored, so a reader can judge how current it is; nothing is
 * presented as freshly generated.
 *
 * ⚠ THIS IS NOT A PRECEDENT FOR THE OTHER NAMESPACES. The test is whether a real backend exists
 * that this client is declining to call. For Help there is none and never will be. For League
 * Health, Managers, Analytics and the rest there is, and serving curated data under a live label
 * there would be the fabrication this module was originally protecting against.
 */
export const liveHelpClient: HelpClient = {
  async getArticles() {
    return { data: HELP_ARTICLES, error: null, source: 'live', timestamp: new Date().toISOString() }
  },
  async getGlossary() {
    return { data: HELP_GLOSSARY, error: null, source: 'live', timestamp: new Date().toISOString() }
  },
}

/**
 * Re-exported so a surface that wants to say "this documentation was last revised on…" reads the
 * same constant the articles are stamped with, rather than deriving a second answer.
 */
export { CATALOG_REVISED_AT }
