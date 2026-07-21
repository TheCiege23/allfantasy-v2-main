# Operator Console — Cutover

**Run only after [OPERATOR_CONSOLE_AUTHED_REVIEW.md](./OPERATOR_CONSOLE_AUTHED_REVIEW.md) passes.**
This is a **routing cutover only** — no content or honesty-status changes. `/admin` stays reachable
as a fallback (never deleted).

---

```
Repoint /admin to the new operator console at /admin/operator, keeping the
existing admin page fully reachable as a fallback. Do NOT delete the old page.

Context:
- The new operator shell lives at app/admin/operator/ (layout.tsx = auth gate,
  page.tsx = overview, [section]/page.tsx = all other sections). It reuses the
  existing data services and the same server-side auth (getAdminAccessState).
- The current /admin is a 1,821-line accordion "Command Center" (~25 sections),
  still wired to real services. It must remain accessible after cutover.
- Both routes gate through the same allowlist + isSiteAdmin / admin_session
  auth. Preserve that exactly — do not weaken or duplicate the gate.

Task:
1. Make /admin render the operator console (the shell currently at
   /admin/operator), and move the existing accordion page to a stable fallback
   route such as /admin/classic (or /admin/legacy). Keep a visible link to the
   fallback from the operator shell so it's one click away.
2. Decide and implement the cleanest mechanism (redirect vs. moving the route
   files vs. re-exporting) — but the result must be: /admin = operator console,
   /admin/classic = old accordion, both behind the identical auth gate.
3. Keep /admin/operator working (redirect it to /admin, or leave it as an
   alias) so any existing links/bookmarks don't 404.
4. Do NOT change section honesty status, the env-badge logic, or the derived
   Attention Queue. This is a routing cutover only, not a content change.

Constraints & gotchas:
- Preserve the neutral "Access denied" behavior on every route (signed-out /
  non-admin must leak nothing).
- The repo has a ~15-error pre-existing tsc baseline in two unrelated WIP files
  (redraft/score-sync, weather/refresh-cron). Your change must add ZERO new
  tsc errors — run the full typecheck and confirm the delta is zero.
- Dev-server gotcha: other sessions may be running dev servers on ports 3000
  and 3100 against the shared working tree / .next. Do NOT start a second
  `next dev` on a shared distDir. Use the isolated next-dev-myteam config
  (separate AF_NEXT_DIST_DIR, .next-myteam-3100) if you need to serve, or just
  point the browser at an already-running server.

Verify before finishing:
- /admin serves the operator console; /admin/classic serves the old accordion;
  /admin/operator no longer 404s.
- Signed-out request to /admin AND /admin/classic both return the neutral
  access-denied screen.
- Typecheck delta is zero new errors.
- Show me the diff (route changes + any redirect config) before finalizing.
```

---

### Implementation note (for whoever runs this)
The current `/admin` layout is the file `app/admin/page.tsx` (1,821 lines) with its own inline auth
gate + `AdminAccessDenied`. The operator shell's gate lives in `app/admin/operator/layout.tsx`.
Cleanest mechanism is likely: move `app/admin/page.tsx` → `app/admin/classic/page.tsx`, then make
`app/admin/page.tsx` render the operator overview (or move the operator tree up to `/admin` and add
a compatibility redirect from `/admin/operator`). Whichever is chosen, both routes must keep passing
through `getAdminAccessState()` and the classic page keeps its own `AdminAccessDenied`.
