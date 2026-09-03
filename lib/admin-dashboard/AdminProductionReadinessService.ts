import "server-only"

import fs from "fs"
import { readVercelCrons as readCronScheduleFromDisk } from "@/lib/production-health/cronRegistry"
import path from "path"
import { prisma } from "@/lib/prisma"

export type EnvReadinessSeverity = "critical" | "warning" | "optional"
export type EnvReadinessStatus = "configured" | "missing"

export type EnvReadinessRow = {
  id: string
  category: string
  label: string
  status: EnvReadinessStatus
  severity: EnvReadinessSeverity
  required: string
  note: string
}
export type CronReadinessStatus = "configured" | "partial" | "missing"

export type CronReadinessRow = {
  id: string
  category: string
  label: string
  status: CronReadinessStatus
  schedule: string
  configuredPaths: string[]
  missing: string[]
  recommended: string
  note: string
}

export type TrafficLocationRow = {
  label: string
  country: string | null
  region: string | null
  city: string | null
  visits: number
  visitors: number
}

export type AdminProductionReadiness = {
  env: EnvReadinessRow[]
  crons: CronReadinessRow[]
  trafficLocations: TrafficLocationRow[]
  trafficNotes: string[]
}

type EnvRequirement = {
  id: string
  category: string
  label: string
  severity: EnvReadinessSeverity
  anyOf?: string[]
  allOf?: string[]
  note: string
}

const ENV_REQUIREMENTS: EnvRequirement[] = [
  {
    id: "world-cup-provider",
    category: "World Cup",
    label: "World Cup provider selection",
    severity: "critical",
    anyOf: ["WORLD_CUP_DATA_PROVIDER"],
    note: "Expected value for launch is apifootball; admin only shows whether it is set.",
  },
  {
    id: "world-cup-cron",
    category: "World Cup",
    label: "World Cup cron secret",
    severity: "critical",
    anyOf: ["WORLD_CUP_CRON_SECRET"],
    note: "Required for scheduled World Cup sync endpoints.",
  },
  {
    id: "world-cup-api-key",
    category: "World Cup",
    label: "World Cup sports provider key",
    severity: "critical",
    anyOf: ["API_SPORTS_KEY", "API_FOOTBALL_KEY", "APISPORTS_FOOTBALL_KEY", "RAPIDAPI_KEY"],
    note: "One provider key must be present for API-Football/API-Sports sync.",
  },
  {
    id: "world-cup-league-id",
    category: "World Cup",
    label: "World Cup league id",
    severity: "critical",
    anyOf: ["API_FOOTBALL_WORLD_CUP_LEAGUE_ID"],
    note: "Needed to request the correct World Cup competition fixtures/standings.",
  },
  {
    id: "rolling-insights",
    category: "General sports",
    label: "Rolling Insights credentials",
    severity: "warning",
    anyOf: ["ROLLING_INSIGHTS_API_KEY", "ROLLING_INSIGHTS_CLIENT_ID"],
    note: "Main multi-sport coverage path where configured.",
  },
  {
    id: "clearsports",
    category: "General sports",
    label: "ClearSports credentials",
    severity: "warning",
    allOf: ["CLEARSPORTS_API_KEY", "CLEARSPORTS_API_BASE"],
    note: "Backup multi-sport facts, injuries, stats, news, and live bridge where configured.",
  },
  {
    id: "thesportsdb",
    category: "General sports",
    label: "TheSportsDB key",
    severity: "optional",
    anyOf: ["THESPORTSDB_API_KEY", "SPORTSDB_API_KEY", "THE_SPORTS_DB_API_KEY"],
    note: "Backup/team media provider. Public fallback is not ideal for production.",
  },
  {
    id: "cfbd",
    category: "General sports",
    label: "College Football Data",
    severity: "optional",
    anyOf: ["CFBD_API_KEY", "CFBD_KEY"],
    note: "NCAAF schedule/team fallback only; does not cover every fantasy need.",
  },
  {
    id: "news",
    category: "General sports",
    label: "News provider",
    severity: "warning",
    anyOf: ["NEWS_API_KEY", "NEWSAPI_KEY"],
    note: "Needed for current player/team news imports where provider routes use NewsAPI.",
  },
  {
    id: "openai",
    category: "AI",
    label: "OpenAI / Chimmy",
    severity: "critical",
    anyOf: ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
    note: "Required for paid AI generation after cached facts are verified.",
  },
  {
    id: "database",
    category: "Platform",
    label: "Database",
    severity: "critical",
    anyOf: ["DATABASE_URL"],
    note: "All user-facing sports data reads from Neon/Postgres cache.",
  },
  {
    id: "auth-secret",
    category: "Platform",
    label: "Auth secret",
    severity: "critical",
    anyOf: ["NEXTAUTH_SECRET", "AUTH_SECRET"],
    note: "Required for secure production sessions.",
  },
  {
    id: "admin",
    category: "Platform",
    label: "Admin access",
    severity: "critical",
    allOf: ["ADMIN_EMAILS", "ADMIN_SESSION_SECRET"],
    note: "Required for founder/admin dashboard and bootstrap recovery safety.",
  },
  {
    id: "stripe",
    category: "Platform",
    label: "Stripe",
    severity: "critical",
    allOf: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    note: "Required for subscriptions/token purchase fulfillment.",
  },
  {
    id: "resend",
    category: "Email",
    label: "Resend email",
    severity: "warning",
    anyOf: ["RESEND_API_KEY"],
    note: "Required for admin test/send and notification email delivery.",
  },
  {
    id: "email-from",
    category: "Email",
    label: "Email sender identity",
    severity: "warning",
    anyOf: ["RESEND_FROM", "RESEND_FROM_EMAIL", "EMAIL_FROM"],
    note: "Production sender identity for transactional and broadcast emails.",
  },
  {
    id: "twilio",
    category: "Messaging",
    label: "Twilio verification",
    severity: "warning",
    allOf: ["TWILIO_ACCOUNT_SID", "TWILIO_VERIFY_SERVICE_SID"],
    note: "Phone verification/SMS support. Token values are never shown.",
  },
  {
    id: "cloudinary",
    category: "Media",
    label: "Cloudinary uploads",
    severity: "optional",
    allOf: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    note: "Used by rich media upload flows where enabled.",
  },
]

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function envStatus(req: EnvRequirement): EnvReadinessStatus {
  const anyOk = req.anyOf ? req.anyOf.some(present) : true
  const allOk = req.allOf ? req.allOf.every(present) : true
  return anyOk && allOk ? "configured" : "missing"
}

function requiredLabel(req: EnvRequirement): string {
  const parts: string[] = []
  if (req.allOf?.length) parts.push(req.allOf.join(" + "))
  if (req.anyOf?.length) parts.push(req.anyOf.join(" or "))
  return parts.join("; ")
}

/**
 * ⚠ THIS WAS A THIRD PRIVATE COPY OF "read the cron list", AND IT DRIFTED. It
 * now delegates to the implementation in `lib/production-health/cronRegistry`,
 * which carries the reasoning: the schedule moved to `cron-schedule.json`, and
 * a `vercel.json`-only read returns nothing. Three copies is how one surface
 * reports a clean bill of health while another reports the truth.
 */
function readVercelCrons(): Array<{ path: string; schedule: string }> {
  return readCronScheduleFromDisk()
}

function cronRow(input: {
  id: string
  category: string
  label: string
  recommended: string
  requiredMatchers: Array<string | RegExp>
  optionalMatchers?: Array<string | RegExp>
  crons: Array<{ path: string; schedule: string }>
  note: string
}): CronReadinessRow {
  const matches = (matcher: string | RegExp) =>
    input.crons.filter((cron) =>
      typeof matcher === "string" ? cron.path.includes(matcher) : matcher.test(cron.path)
    )
  const requiredMatches = input.requiredMatchers.flatMap(matches)
  const optionalMatches = (input.optionalMatchers ?? []).flatMap(matches)
  const configuredPaths = [...requiredMatches, ...optionalMatches].map((cron) => `${cron.path} (${cron.schedule})`)
  const missing = input.requiredMatchers
    .filter((matcher) => matches(matcher).length === 0)
    .map((matcher) => String(matcher))
  const status: CronReadinessStatus =
    missing.length === 0
      ? "configured"
      : configuredPaths.length > 0
        ? "partial"
        : "missing"

  return {
    id: input.id,
    category: input.category,
    label: input.label,
    status,
    schedule: configuredPaths.length > 0 ? configuredPaths.join(" | ") : "Not configured",
    configuredPaths,
    missing,
    recommended: input.recommended,
    note: input.note,
  }
}

async function getTrafficLocations(): Promise<TrafficLocationRow[]> {
  try {
    const rows = await prisma.visitorLocation.groupBy({
      by: ["country", "region", "city"],
      _sum: { visits: true },
      _count: { _all: true },
      orderBy: { _sum: { visits: "desc" } },
      take: 12,
    })
    return rows.map((row) => {
      const label = [row.city, row.region, row.country].filter(Boolean).join(", ") || "Unknown"
      return {
        label,
        country: row.country,
        region: row.region,
        city: row.city,
        visits: row._sum.visits ?? 0,
        visitors: row._count._all,
      }
    })
  } catch {
    return []
  }
}

export async function getAdminProductionReadiness(): Promise<AdminProductionReadiness> {
  const crons = readVercelCrons()
  const trafficLocations = await getTrafficLocations()

  return {
    env: ENV_REQUIREMENTS.map((req) => ({
      id: req.id,
      category: req.category,
      label: req.label,
      status: envStatus(req),
      severity: req.severity,
      required: requiredLabel(req),
      note: req.note,
    })),
    crons: [
      cronRow({
        id: "world-cup-official",
        category: "World Cup",
        label: "Official teams/fixtures/standings/live sync",
        /*
         * 🛑 `job=all` SATISFIES ALL FOUR, AND MATCHING ONLY THE NAMED JOBS RAISED A
         * FALSE CRITICAL. The schedule consolidated to one entry —
         * `/api/brackets/world-cup/cron/sync?job=all&provider=apifootball&recalculate=true`
         * at `0 8 * * *` — but these matchers still looked for four separate
         * `job=<name>` strings. `job=all` contains none of them, so the Command
         * Center's top card reported "Official teams/fixtures/standings/live sync is
         * not scheduled" as its one CRITICAL item while that sync was scheduled.
         *
         * The route is the authority, and it branches on `|| job === "all"` for every
         * one of these (app/api/brackets/world-cup/cron/sync/route.ts):
         *
         *     if (job === "teams"       || job === "all") -> syncWorldCupTeams
         *     if (job === "fixtures"    || job === "all") -> fixtures
         *     if (job === "live"        || job === "all") -> syncWorldCupLiveScoresBatch
         *     if (job === "standings"   || job === "all") -> standings
         *     if (job === "recalculate" || job === "all") -> recalculate
         *
         * ⚠ A FALSE CRITICAL IS NOT COSMETIC. This card is what an operator reads
         * first, and a permanent red that everyone learns to ignore is worse than no
         * card — the next real outage then arrives in a channel already trained to
         * look away.
         *
         * `\b` after the alternation so `job=all` matches while a hypothetical
         * `job=allocate` would not.
         */
        requiredMatchers: [
          /\/api\/brackets\/world-cup\/cron\/sync\?job=(teams|all)\b/,
          /\/api\/brackets\/world-cup\/cron\/sync\?job=(fixtures|all)\b/,
          /\/api\/brackets\/world-cup\/cron\/sync\?job=(standings|all)\b/,
          /\/api\/brackets\/world-cup\/cron\/sync\?job=(live|all)\b/,
        ],
        optionalMatchers: [/\/api\/brackets\/world-cup\/cron\/sync\?job=(recalculate|all)\b/],
        recommended: "Teams/fixtures daily; standings every 30m during tournament; live every 5m during active windows.",
        crons,
        note: "World Cup official sync exists when these scheduled routes are present and cron secret/env are configured.",
      }),
      cronRow({
        id: "general-schedules-scores",
        category: "General sports",
        label: "Schedules and scores",
        requiredMatchers: ["/api/cron/import-schedules", "/api/cron/import-scores"],
        recommended: "Schedules daily; live scores only during active game windows.",
        crons,
        note: "User pages read cached games only; these jobs keep cache current.",
      }),
      cronRow({
        id: "general-standings",
        category: "General sports",
        label: "Standings",
        requiredMatchers: ["/api/cron/import-standings"],
        recommended: "Every 4-24h depending on sport calendar; after games when possible.",
        crons,
        note: "Feeds power rankings, matchup prep, and Chimmy confidence.",
      }),
      cronRow({
        id: "general-injuries-news",
        category: "General sports",
        label: "Injuries and news",
        requiredMatchers: ["/api/cron/import-injuries", "/api/cron/import-news"],
        optionalMatchers: ["/api/cron/import-espn-injuries"],
        recommended: "Injuries every 3-12h; news every 2-6h with provider budget protection.",
        crons,
        note: "Feeds injury impact, waiver/trade context, and notification rules.",
      }),
      /*
       * 🛑 `/api/cron/import-rankings` NEVER EXISTED AS A ROUTE. Grepped the tree: no
       * `app/api/cron/import-rankings` directory, no match anywhere in cron-schedule.json.
       * So this requiredMatcher could never be satisfied, and this row could never report
       * anything but "partial" — a permanent, lower-severity sibling of the world-cup false
       * critical fixed earlier tonight, same file, same underlying mistake: a matcher
       * describing a route that was renamed, consolidated, or never built under that name.
       *
       * THE CAPABILITY IS NOT MISSING — IT LIVES UNDER TWO OTHER NAMES. Traced downstream
       * from the note's own claim ("draft, start/sit, waiver, trade value"):
       * lib/adp/loadAdpBoard.ts documents itself as "THE one place an AllFantasy ADP board
       * is loaded for a league context", consumed by lib/draft-room/adp-ordering.ts and the
       * waiver/trade engines. It is fed by two scheduled crons, neither named "rankings":
       *
       *   /api/cron/adp-refresh              daily, 10:00 UTC. Its own docstring says it
       *                                       builds "consensus rows for all supported
       *                                       sports" from Fantrax/Sleeper/ESPN/MFL/NFFC/FFC/
       *                                       Rolling Insights — and its own comments record
       *                                       that ingestPlayerValues() (trade value) and
       *                                       runAiAdpJob() ride along on the same run for the
       *                                       identical reason this repo already knows:
       *                                       "`scripts/ingest-player-values.ts` had no
       *                                       scheduler ... runAiAdpJob ... had NO caller
       *                                       anywhere in the repo" — the ingestCFBDStats
       *                                       shape, adopted rather than repeated.
       *   /api/cron/recompute-allfantasy-adp  AllFantasy's own draft-derived board, rebuilt
       *                                       from real DraftFact history rather than an
       *                                       external feed.
       *
       * Either is accepted as satisfying this row — they answer the same question
       * ("is a rankings/consensus board being kept current") from two different sources, and
       * an operator does not need both green to trust the row.
       *
       * ⚠ WEAKER EVIDENCE THAN THE WORLD-CUP FIX, AND SAID SO ON PURPOSE. That fix had a
       * single route branching on `|| job === "all"` — provably the same code path. This is
       * two DIFFERENTLY NAMED crons standing in for one described capability, which is a
       * product judgment about what counts as "rankings" being served, not a code-level proof.
       * If that judgment is wrong, the fix is to split this into its own row rather than widen
       * the matcher further.
       */
      cronRow({
        id: "general-players-stats-rankings",
        category: "General sports",
        label: "Players, stats, projections, rankings",
        requiredMatchers: [
          "/api/cron/import-players",
          "/api/cron/import-projections",
          /\/api\/cron\/(adp-refresh|recompute-allfantasy-adp)\b/,
        ],
        optionalMatchers: ["/api/cron/import-depth-charts"],
        recommended: "Players daily; stats/projections/rankings daily or after games.",
        crons,
        note: "Required for draft, start/sit, waiver, trade value, and player identity accuracy.",
      }),
    ],
    trafficLocations,
    trafficNotes: [
      "AnalyticsEvent currently stores path/referrer/session/user-agent and optional userId/meta.",
      "VisitorLocation is aggregate-only in admin; raw IPs are not selected or rendered.",
      "If exact geo is unavailable from platform headers, admin should show Not tracked yet rather than call a paid geo API per request.",
    ],
  }
}
