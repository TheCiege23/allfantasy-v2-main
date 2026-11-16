import { managerProfilesRetired } from './retired'
import type { ManagerIntelligenceClient } from './types'

/**
 * Manager Intelligence, live mode: the directory is RETIRED, and this client says so.
 *
 * 🛑 THE SCREEN TOLD PAYING COMMISSIONERS "No manager history yet." FOR A MODULE THAT NO LONGER EXISTS
 * (2026-11-16, re-score item 10). This client read `/api/v1/intelligence/league/manager-dna`. The
 * Milestone 32 privacy pass (`dcaaa6946`) retired that route and twelve others to a constant
 * `410 PROFILE_SURFACE_RETIRED`, because AllFantasy no longer builds behavior profiles of named
 * managers for anybody, commissioners included. This client was not updated. It called the dead
 * route and got an error. The page then dropped the error and rendered `data ?? []`, so a deliberate
 * retirement read as "your league has no history yet; check back later". That empty state promised
 * something that was never coming.
 *
 * So it no longer makes the call, and it returns a fixed, recognisable error that the screen renders
 * as the truth: the profiles are retired. It never fails as "not yet integrated" and never returns an
 * empty list. Both of those say "wait", and there is nothing to wait for.
 *
 * Bringing a manager screen back is a product decision, not a repair. If it returns, it shows plain
 * activity FACTS (lineups set, moves made), not classifications. The owner's rule for psychology is
 * "facts only, paid" (re-score item 11), and a fresh route has to be built for it. This one must not
 * be revived.
 */
export const liveManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    return { data: null, error: managerProfilesRetired(), source: 'live', timestamp: new Date().toISOString() }
  },
}
