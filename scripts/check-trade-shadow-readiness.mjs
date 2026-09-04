#!/usr/bin/env node
/**
 * Trade-shadow readiness — Phase 1 of the "One Engine, One Answer" plan.
 *
 * ── The failure this exists to make visible ───────────────────────────────────────────────────
 *
 * The trade convergence (AF_TRADE_UNIFICATION_BRIEF) is designed correctly: every live surface
 * reports BESIDE the canonical `manager.trade.evaluate` path, and Phase 3 flips each surface once
 * its shadow sample says the canonical verdict agrees.
 *
 * Measured 2026-09-04 against production: `decision_parity_record` holds 9,420 rows — 9,340
 * `manager.lineup.set` and 80 `commissioner.league.health`. **`manager.trade.evaluate` has NEVER
 * recorded a single row.** The surface flags default off, nothing reported that they were off, and
 * so the gate Phase 3 depends on has been empty for the entire life of the programme.
 *
 * That is the scheduled-writer trap from CLAUDE.md wearing different clothes: a mechanism built,
 * correct, and never switched on — failing silently and looking finished. The cure is not more
 * code. It is a check that says so out loud.
 *
 * Read-only. Never writes. Always exits 0 — a report, not a gate. Failing a build over an unset
 * telemetry flag would be worse than the silence it replaces.
 *
 * Usage:  node scripts/check-trade-shadow-readiness.mjs
 */
import { execFileSync } from "node:child_process";

/**
 * ⚠ THERE IS NO MASTER FLAG, and the first version of this script claimed there was.
 *
 * `shouldRunTradeSurfaceShadow` calls `shouldRunShadow(SURFACE_FLAGS[surface], env)` with the
 * surface's own flag and nothing else. `DECISION_OS_TRADE_SHADOW` (bare) is a SIBLING gating
 * `lib/decision-os/trade/shadow.ts` — the canonical shadow on the legacy path — not a master over
 * the six below. Setting it enables no surface.
 */
const LEGACY_PATH_FLAG = "DECISION_OS_TRADE_SHADOW";

/**
 * Surface flags. The five war rooms deliberately share ONE flag, and the `TradeSurface` values
 * they record under are `warroom_<format>` — so counts group under those, never a bare "warroom".
 */
const SURFACE_FLAGS = [
  { flag: "DECISION_OS_TRADE_SHADOW_CONSOLE", surfaces: ["console"], note: "Trade Value Console" },
  { flag: "DECISION_OS_TRADE_SHADOW_DYNASTY", surfaces: ["dynasty"], note: "dynasty analyzer" },
  { flag: "DECISION_OS_TRADE_SHADOW_KEEPER", surfaces: ["keeper"], note: "keeper analyzer" },
  { flag: "DECISION_OS_TRADE_SHADOW_DRAFTPICK", surfaces: ["draftpick"], note: "draft-pick builder" },
  { flag: "DECISION_OS_TRADE_SHADOW_LEGACY", surfaces: ["legacy"], note: "/af-legacy analyzer" },
  {
    flag: "DECISION_OS_TRADE_SHADOW_WARROOM",
    surfaces: [
      "warroom_redraft",
      "warroom_dynasty",
      "warroom_keeper",
      "warroom_bestball",
      "warroom_guillotine",
    ],
    note: "five war rooms (one flag)",
  },
];

/**
 * 🛑 THE SCOPE TRAP, and it is the one most likely to waste a week.
 *
 * `shouldRunShadow` also requires `matchesDecisionShadowScope(scope, env)`, and
 * `recordTradeSurfaceShadow` passes NO scope. So if either variable below is set — for ANY slice,
 * including the lineup shadow that is already running — `hasScope` becomes true, an undefined
 * scope matches nothing, and every trade surface collects zero however its own flag is set.
 */
const SCOPE_FLAGS = ["DECISION_OS_TEST_USERNAMES", "DECISION_OS_TEST_LEAGUE_IDS"];

/** The app accepts EXACTLY "true", trimmed and lowercased. `1`, `yes` and `on` are all OFF. */
function isOn(name) {
  return String(process.env[name] ?? "").trim().toLowerCase() === "true";
}

function isSet(name) {
  return String(process.env[name] ?? "").trim().length > 0;
}

/**
 * Counts come from the read-only probe rather than a Prisma import, so this script cannot write
 * and cannot pull `.env` into a process that might. `--env=local` names the production endpoint
 * explicitly; schema-identical Neon branches are otherwise indistinguishable, and a count from the
 * wrong branch is worse than no count.
 */
function queryCounts() {
  const sql = `
    select coalesce(surface, '(none)') as surface, count(*) as rows,
           to_char(max("recordedAt"),'YYYY-MM-DD HH24:MI') as newest
    from decision_parity_record
    where "decisionType" = 'manager.trade.evaluate'
    group by surface order by rows desc
  `;
  try {
    const out = execFileSync(
      process.execPath,
      ["scripts/db-readonly-probe.mjs", "--env=local", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const rows = [];
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        rows.push(JSON.parse(t));
      } catch {
        /* a non-JSON line is not a row */
      }
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e), rows: [] };
  }
}

/**
 * 🛑 THE TWO COLUMNS COME FROM DIFFERENT PLACES, and conflating them is the mistake this label
 * exists to prevent.
 *
 * Flag state is read from THIS process's environment. Observation counts come from the PRODUCTION
 * database. Run this locally after setting a flag in Railway and the flags read "off" while the
 * counts are real — which looks exactly like "the change did not take". It means the flag is not
 * set on your laptop, and says nothing at all about Railway.
 */
function whereAmI() {
  const railwayEnv = String(
    process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? "",
  ).trim();
  return railwayEnv ? `Railway (${railwayEnv})` : "this shell (LOCAL — not Railway)";
}

function onRailway() {
  return Boolean(
    String(process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? "").trim(),
  );
}

function main() {
  console.log("Trade-shadow readiness\n");
  console.log(`  flag state read from : ${whereAmI()}`);
  console.log("  observation counts   : production database\n");

  const scoped = SCOPE_FLAGS.filter(isSet);
  if (scoped.length > 0) {
    console.log("  🛑 SCOPE FILTER SET — every trade surface will collect ZERO regardless of flags:");
    for (const f of scoped) console.log(`       ${f}`);
    console.log("     recordTradeSurfaceShadow passes no scope, so an active filter excludes it.");
    console.log("     Unset these, or the surface flags below have no effect.\n");
  }

  console.log(`  ${LEGACY_PATH_FLAG.padEnd(36)} ${isOn(LEGACY_PATH_FLAG) ? "on" : "off"}   (legacy path only — NOT a master)\n`);

  const counts = queryCounts();
  const bySurface = new Map();
  let total = 0;
  for (const r of counts.rows) {
    bySurface.set(r.surface, r);
    total += Number(r.rows ?? 0);
  }

  console.log("  flag                                    state*  obs   newest");
  console.log("  " + "-".repeat(68));
  for (const { flag, surfaces, note } of SURFACE_FLAGS) {
    const on = isOn(flag) && scoped.length === 0;
    let n = 0;
    let newest = "never";
    for (const s of surfaces) {
      const row = bySurface.get(s);
      if (!row) continue;
      n += Number(row.rows ?? 0);
      if (row.newest && (newest === "never" || row.newest > newest)) newest = row.newest;
    }
    console.log(
      `  ${flag.padEnd(38)} ${(on ? "on" : "off").padEnd(6)} ${String(n).padStart(4)}   ${newest}   ${note}`,
    );
  }
  console.log("");

  if (!counts.ok) {
    console.log(`  Could not read the parity table: ${counts.error}`);
    console.log("  Flag state above is still accurate for THIS environment.\n");
    process.exit(0);
  }

  if (total === 0) {
    console.log("  🛑 manager.trade.evaluate has recorded ZERO observations.");
    console.log("     Phase 3 flips a surface once its shadow sample shows the canonical verdict");
    console.log("     agreeing. There is no sample. No surface is flippable on evidence today, and");
    console.log("     the first step is turning one flag on and letting it collect — not more code.\n");
    console.log("     Set exactly:  DECISION_OS_TRADE_SHADOW_CONSOLE=true\n");
  } else {
    console.log(`  ${total} trade observation(s) recorded.`);
    const unattributed = bySurface.get("(none)");
    if (unattributed) {
      console.log(
        `  ⚠ ${unattributed.rows} carry no surface. A sample that cannot say which surface it came` +
          " from cannot gate a per-surface flip.\n",
      );
    } else {
      console.log("  Every observation is attributed to a surface.\n");
    }
  }

  console.log(`  * state reflects ${whereAmI()}.`);
  if (!onRailway()) {
    console.log("    Production flags live in Railway and are NOT visible from here. A flag you");
    console.log("    set there will still read off in this output. The obs column IS production,");
    console.log("    and it is the one that proves collection started.\n");
  } else {
    console.log("");
  }

  process.exit(0);
}

main();
