/**
 * Prints the DB-free harnesses' API answers and frame list as JSON for scripts/e2e-harness-capture.mjs.
 *
 *   npx tsx scripts/e2e-harness-api.ts
 *
 * The fixtures are TypeScript, typed against the app's own response types with `satisfies`, so they stay the
 * single source; this file only gathers them. It touches no database, no network and no environment.
 */
import type { HarnessApiRoute } from '../app/e2e/harnessApi'
import { HARNESS_API as C2C_API } from '../app/e2e/c2c/fixtures'
import { HARNESS_API as DEVY_API } from '../app/e2e/devy/fixtures'
import { HARNESS_API as IDP_API } from '../app/e2e/idp/fixtures'
import { HARNESS_API as TOURNAMENT_API, TOURNAMENT_ID } from '../app/e2e/tournament/fixtures'
import { COMMISSIONER_HARNESS_API } from '../app/e2e/tournament/commissioner-fixtures'
import { TOURNAMENT_HARNESS_SCREENS } from '../app/e2e/tournament/screens'

type Frame = { name: string; path: string }
type Harness = { routes: HarnessApiRoute[]; frames: Frame[] }

const C2C_SCREENS = ['roster', 'campus', 'canton', 'matchup', 'picks']
const DEVY_SCREENS = ['roster', 'picks']
const IDP_SCREENS = ['cap', 'contracts']
/** The commissioner dashboard's tab ids, in its own order (components/tournament/TournamentCommissionerDashboard.tsx). */
const COMMISSIONER_TABS = ['overview', 'leagues', 'standings', 'drafts', 'settings', 'members', 'chat', 'ai', 'media', 'subscription', 'approvals', 'history']

const harnesses: Record<string, Harness> = {
  c2c: {
    routes: C2C_API,
    frames: C2C_SCREENS.map((s) => ({ name: s, path: `/e2e/c2c/e2e-c2c/${s}` })),
  },
  devy: {
    routes: DEVY_API,
    frames: DEVY_SCREENS.map((s) => ({ name: s, path: `/e2e/devy/e2e-devy/${s}` })),
  },
  idp: {
    routes: IDP_API,
    // The league header links these with ?rosterId=; the clients read it from the URL.
    frames: IDP_SCREENS.map((s) => ({ name: s, path: `/e2e/idp/e2e-idp/${s}?rosterId=ckidproster00001` })),
  },
  tournament: {
    routes: [...TOURNAMENT_API, ...COMMISSIONER_HARNESS_API],
    frames: [
      ...TOURNAMENT_HARNESS_SCREENS.filter((s) => s !== 'commissioner').map((s) => ({ name: s, path: `/e2e/tournament/${TOURNAMENT_ID}/${s}` })),
      ...COMMISSIONER_TABS.map((tab) => ({ name: `commissioner-${tab}`, path: `/e2e/tournament/${TOURNAMENT_ID}/commissioner?tab=${tab}` })),
    ],
  },
}

process.stdout.write(JSON.stringify(harnesses))
