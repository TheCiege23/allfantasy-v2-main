# Build Runtime Runbook (Next 14 / Windows)

## Current status

- Framework/runtime: `next@14.2.35`
- Local OS: Windows (`win32`)
- Local Node variants tested:
  - `v22.22.0` (default local)
  - `v20.20.2` (via `npx -y node@20`)
- Current known failure point:
  - Build reaches `Creating an optimized production build ...`
  - Then stalls during compile phase and does not progress to route/static generation logs.

## Runtime pin

- `package.json`:
  - `"engines": { "node": "20.x" }`
- `.nvmrc`:
  - `20`

## Required env vars for diagnostics

Minimum:

- `NODE_OPTIONS=--max-old-space-size=16384`
- `NEXT_TELEMETRY_DISABLED=1`

Optional diagnostic flags:

- `AF_NEXT_BUILD_STATIC_WORKERS=1` (when using project harness)
- `NEXT_PRIVATE_DEBUG_CACHE=1`
- `NEXT_PRIVATE_BUILD_WORKER=1`
- `DEBUG=next:*`

Temporary local diagnostic toggles in `next.config.js` (env-gated):

- `AF_NEXT_DIAG_DISABLE_INSTRUMENTATION=1`
- `AF_NEXT_DIAG_DISABLE_SWC_MINIFY=1`

## Clean build prep steps

1. Kill overlapping build processes (`npm run build`, `next build`, `vercel-next-build.cjs`).
2. Remove output dirs:
   - `.next-build-fix`
   - `.next`
   - `.next-build-disabled-routes`
3. Run exactly one narrowed diagnostic command.

## Raw Next vs harness comparison

Both were tested on Node 20 and both stall at the same compile message:

- Harness path:
  - `npm run build` (uses `scripts/vercel-next-build.cjs`)
- Raw path:
  - `npx -y node@20 node_modules/next/dist/bin/next build`

Result: same compile-stage stall, indicating the issue is **not isolated** to `vercel-next-build.cjs`.

## Windows/Linux comparison status

- WSL/Linux unavailable on this machine (`wsl` not installed).
- Linux/CI comparison remains required to confirm whether this is Windows-specific.

Recommended CI/Linux check:

```bash
NODE_OPTIONS=--max-old-space-size=16384 NEXT_TELEMETRY_DISABLED=1 npx next build
```

Capture exit code and last 100 lines.

## Proceed / block policy

- Phase 7L remains blocked until one of:
  1. Raw Next build passes locally, or
  2. CI/Linux raw Next build passes and local failure is accepted/documented as Windows-only.

