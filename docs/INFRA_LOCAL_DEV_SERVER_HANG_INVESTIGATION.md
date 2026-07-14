# Local Dev Server Hang — Investigation Report

Scope note: this is an infrastructure investigation only. No Decision OS, SDK runtime, or
product behavior was changed. Architecture Freeze and Stage 1 Soak are unaffected. Readiness
is unchanged (NFL Engine 93%, Overall Platform 90%).

## Symptom

`npm run dev` (and Playwright's `webServer`-driven `next dev`) would start, print
`✓ Starting...`, and then never reach `✓ Ready in Xms`. CPU usage on the server process stayed
near zero for many minutes — consistent with an I/O/wait stall, not a slow compile. This blocked
all local browser proof for G24 and had already been documented (unresolved) in
`docs/G24_DECISION_OS_PREMIUM_EXPERIENCE.md`.

## Root cause (confirmed)

**A corrupted, partially-written Next.js dev build cache directory.** Two instances were found
and fixed:

1. `.next-dev-local` (used by `npm run dev`, per `package.json`'s `AF_NEXT_DIST_DIR` env var) —
   had `server/`, `cache/`, `types/` but **no `static/` directory at all** and no
   `build-manifest.json`. Consistent with an interrupted/killed `next dev` process leaving a
   half-written cache.
2. `.next-playwright-3101` (used by Playwright's `webServer`, per `playwright.config.ts`) — had a
   `static/chunks/` directory but **`webpack.js` was missing inside it**. Same failure family, via
   a different entry point.

**Direct proof:** pointing `next dev` at a brand-new, never-used `AF_NEXT_DIST_DIR` (bypassing
both corrupted caches) reached `✓ Ready in 5.5s` immediately, on the same machine, same repo,
same drive. After deleting the two corrupted cache directories, both the normal `npm run dev`
path and Playwright's `webServer` path reached Ready normally and served real pages.

## Why the existing safety net didn't catch it

`scripts/clean-next-dev.cjs` already runs before `next dev` in the `npm run dev` script and is
designed to detect and wipe corrupted dev caches. Two gaps let this slip through:

- Its corruption check `hasMissingOrTinyClientWebpackRuntime()` returns `false` (not corrupt)
  when the `static/chunks` directory **doesn't exist at all** — it only catches the case where
  the directory exists but `webpack.js` inside it is missing or truncated. `.next-dev-local`'s
  `static/` directory was entirely absent, so this specific corruption signature was invisible to
  the detector. (Not patched in this ticket — flagged below as the recommended follow-up, since
  fixing it is a real code change and this ticket is investigation/diagnosis only.)
- `clean-next-dev.cjs` only runs as part of the `npm run dev` / `dev:reset` npm scripts.
  **Playwright's `webServer.command` in `playwright.config.ts` invokes `npx next dev` directly**,
  bypassing the cleaning script entirely — so a corrupted `.next-playwright-<port>` cache from a
  previously killed/interrupted Playwright run persists indefinitely and is never auto-healed.

## How the caches likely got corrupted

Both corrupted directories date to previous `next dev` processes being killed mid-startup:

- `.next-dev-local`: this session's own earlier browser-proof attempt was stopped
  (`preview_stop`) while still mid-compile, leaving a partial cache.
- `.next-playwright-3101`: an orphaned Next.js server process (PID 32076, started ~5 hours
  earlier) was found still listening on port 3101 but not responding to HTTP requests — almost
  certainly the process behind the previously-documented blocked Playwright attempt
  (`npx next dev -p 3101 --hostname 127.0.0.1`, matching `playwright.config.ts`'s exact
  `webServer.command`). It was terminated as part of this investigation (stale, unresponsive,
  holding a port needed for retesting).

## Hypotheses checked and ruled out

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| Wrong Node/npm/Next version | Node 20.19.0, npm 10.8.2, Next 14.2.35 vs. declared `^14.2.15` — consistent | Ruled out |
| Broken/inconsistent lockfile | Only `package-lock.json` present (no competing yarn/pnpm lock); `npm ls --depth=0` showed only minor extraneous native-addon packages, no missing/UNMET deps | Ruled out |
| Orphaned processes / locked ports | Found and confirmed real: PID 32076 on port 3101, unresponsive; terminated | **Confirmed contributing factor**, not the root defect itself |
| `instrumentation.ts` blocking on a network call at boot | Read `register()` and its three awaited imports (`validateProductionEnv`, `provider-config`, `error-tracking`); all three are synchronous, no `fetch`/`await`/network calls in the actually-awaited paths (`initSentryServer` fires its async work via `void (async () => {...})()`, never awaited by the caller) | Ruled out |
| `clean-next-dev.cjs` itself hanging | Script is synchronous `fs` calls only; its `[clean-next-dev]` log lines only print when it actually removes something or in `--verbose` mode (neither applies to the plain `dev` script), so its silence in logs was expected, not evidence of a hang there | Ruled out |
| Slow/network drive (`F:` is USB, exFAT) | Confirmed `F:` is a USB 3.2 external drive (not the internal NVMe) formatted exFAT. This raised suspicion but a plain file enumeration of `node_modules` (83,930 files) completed in 5.6s — not catastrophically slow. A fresh dist dir on this same drive reached Ready in 5.5s, proving the drive/filesystem itself is not the blocking factor | Ruled out as the cause (remains a plausible amplifier of cold-compile time in general, but not what caused the indefinite hang) |
| Windows Defender real-time scanning | Confirmed real-time monitoring is enabled; exclusions could not be checked without admin rights | Not confirmed either way — did not turn out to matter once the actual cache corruption was found and fixed |
| `next.config.js` doing blocking work at boot | Not deeply audited once the cache-corruption reproduction/fix fully explained and resolved the symptom | Not investigated further (root cause found first) |

## Resolution applied

1. Identified the two corrupted cache directories (`.next-dev-local`, `.next-playwright-3101`).
2. Terminated the stale orphaned process holding port 3101 (unresponsive, 5+ hours old).
3. Deleted both corrupted directories. Both are pure generated build output, already in
   `clean-next-dev.cjs`'s own `SAFE_ROOTS` allow-list — deleting them is exactly what the
   existing cleaning script is designed to do when it detects corruption; no source, config, or
   product file was touched.
4. Verified:
   - `npm run dev` (via `preview_start`) reached Ready and served `/e2e/dashboard-soccer-grouping`
     with a full, correct render (hero, League Pulse card with confidence/evidence/derivation,
     Get Started checklist, connected leagues) — confirmed via accessibility snapshot.
   - `npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium
     --reporter=line --workers=1` — the `webServer` started and reached Ready normally; the test
     ran to completion (no hang, no timeout). It failed on an unrelated, genuine test/product
     issue (a Playwright strict-mode locator collision: two elements on the dashboard now share
     the exact text "Connected leagues" — one is the existing section header, the other is a
     League Pulse evidence row). This is a real finding, not an infra problem, and is out of
     scope for this investigation — flagged separately rather than fixed here.

No source code, Decision OS logic, SDK runtime, or product behavior was modified. Only generated
build-cache directories were deleted and a stale process was terminated.

## Recommended follow-up (not applied — out of scope for this investigation)

1. Extend `clean-next-dev.cjs`'s `hasMissingOrTinyClientWebpackRuntime()` to also treat a
   completely absent `static/` (or `static/chunks/`) directory as corruption when `server/` or
   `cache/` already exist — the current logic's `if (!fs.existsSync(chunksDir)) return false`
   line is the exact gap that let `.next-dev-local`'s corruption go undetected. Small, isolated,
   testable change (the file already has unit-testable pure predicates).
2. Consider routing Playwright's `webServer.command` in `playwright.config.ts` through
   `clean-next-dev.cjs` (or an equivalent lightweight corruption check) so a killed/interrupted
   Playwright run doesn't leave a silently-corrupted `.next-playwright-<port>` cache for the next
   run to hang on.
3. Fix the "Connected leagues" text collision surfaced during Playwright verification (tracked as
   a separate flagged task, not part of this investigation).

## Verification commands (for reference)

```
npm run dev                         # reaches Ready normally now
npx playwright test e2e/unified-dashboard-click-audit.spec.ts --project=chromium --reporter=line --workers=1
```
