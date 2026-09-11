# Abandoned: the unlanded residue of local `main`, 2026-09-11

Three commits on the shared checkout's local `main` were **deliberately
abandoned** on 2026-09-11. They are preserved under tags and can be revived; this
file is why they were not landed, so that decision does not have to be
re-derived by whoever finds them next.

| commit | tag | subject |
| --- | --- | --- |
| `d13c95f73` | `abandoned/2026-09-11/decision-os-waiver-slice-producer` | feat(decision-os): the waiver slice had no producer because only a browser had ever built its input |
| `cfaf2aefc` | `abandoned/2026-09-11/decision-os-waiver-slice-perf` | perf(decision-os): the waiver slice works and costs ~6.6s, so the chat route stops asking for it |
| `3a34efb9a` | `abandoned/2026-09-11/identity-key-convention-docs` | docs(identity): the measurement that picked this script's key convention has inverted |

🛑 **NOT DELETED. The tags are annotated and each carries its own revival notes.**
Before these tags existed the three had **zero remote refs** — they lived only in
one clone, reachable from local branches that a cleanup would have pruned. Anyone
resetting local `main` would have destroyed them with nothing to notice.

## Why they were not landed

**They have no reachable author.** Dated 2026-09-07 and 09-08. The sessions that
wrote them had ended; the oldest session in the room when this was investigated
had started six hours earlier. Seven sessions were asked directly and none
claimed them.

⚠ **AND THEY ARE UNATTRIBUTABLE BY CONSTRUCTION, WHICH IS A REPO PROPERTY WORTH
KNOWING.** Every commit here carries the same git author (the shared account) and
the same `Co-Authored-By: Claude Opus 5` line that every session emits. Neither
identifies a session. So for any commit whose author-session has ended, there is
no command that recovers ownership — `git log -1 --format='%an %ad'` settles
authorship everywhere else in this repo and settles nothing here. Provenance for
unlanded work depends entirely on a session still being alive to claim it.

**All three conflict onto `main`**, so landing them means resolving somebody
else's three-to-four-day-old work against a branch that had moved 261 commits:

```
d13c95f73   12 files, 3 changed on main, 12 conflict hunks (8 in decisionBridge.ts)
cfaf2aefc    7 files, 6 changed on main,  4 hunks across packet / intentToWant /
                                            flags / grounding-proof route
3a34efb9a    1 file,  1 changed on main,  2 hunks (scripts/backfill-nfl-identity.ts)
```

CLAUDE.md's conflict rule applies directly: *both sides real work → stop and find
the author.* The author could not be found, so the rule says stop.

## If they are revived

🛑 **`d13c95f73` AND `cfaf2aefc` ARE A PAIR AND MUST LAND PRODUCER-FIRST.** This is
the part no one reconstructs from two commit subjects later.

`d13c95f73` adds the waiver-slice producer. `cfaf2aefc` is the perf follow-up that
stops the chat route *asking* for the slice, on the grounds that it costs ~6.6s.

Landing the perf commit alone does not merely disable a consumer of something
absent — **it disables it citing a cost that does not exist.** Verified against
`origin/main` at the time of writing:

- `lib/decision-os/grounding/intentToWant.ts` still says, in its own words:
  *"⚠ FIVE FLAGS, NOT SEVEN — and `waiverDecision` is mapped for a reason that is
  NOT 'it works'. It still has no producer."*
- that file's measured table reads `waiver 1,004 ms` — fast precisely **because**
  it returns an honest `no_producer` gap rather than computing anything. There is
  no 6.6s to optimise away until the producer lands.

⚠ **AND THAT COMMENT BECOMES FALSE THE MOMENT `d13c95f73` LANDS, WITH NOTHING TO
FLAG IT.** Whoever revives the pair must correct it in the same commit. It is the
stale-absence-claim shape in an unusually load-bearing file — `intentToWant.ts` is
the map from Chimmy intent to which grounding slices get built.

`3a34efb9a` is unrelated to the pair and is the cheapest of the three.

## How this list was arrived at, and why the number is small

A patch-id census of local `main` against `origin/main` reported **15 commits as
unlanded**. That number was wrong, and wrong in a direction that would have
reverted production.

🛑 **PATCH-ID EQUALITY IS PROOF; PATCH-ID INEQUALITY IS NOT EVIDENCE.** Equal ids
mean one change under two SHAs. Unequal ids mean only that two diffs differ
textually — and under a cherry-pick convention any pick that auto-merges, rebases
or resolves a conflict changes the id. So the test reports "absent" **most
reliably for the commits whose work was improved on its way in.**

Two sessions ran that census independently and got 15 and 16. The true residue is
three. **The method miscounts by roughly 5x, reproducibly.**

Re-tested with the decisive checks, the 15 resolved as:

```
8  superseded          6 by subject match on main, 2 by content superset
1  already in flight   identical patch-id to a commit in another session's batch
1  folded by author    superseded by a fold the author landed instead
1  already on main     landed under a different sha while its pick sat in the queue
3  abandoned           this file
1  unclear             1f90c12f6 — one of its five files is absent from main entirely
```

⚠ **`cabc72677` IS THE EXPENSIVE EXAMPLE AND IS NOT ABANDONED — IT IS SUPERSEDED.**
It looked unlanded by patch-id. `origin/main`'s `scripts/pre-push-smoke.mjs` is
**+308/-27** against its version and carries `AF_SMOKE_COLD` four times — the
change that took a push from a 20-minute budget to 83 seconds. Landing it would
have reverted that, with nothing going red.

**Ask "is this WORK on main" in this order:**

1. **Attempt the pick.** `The previous cherry-pick is now empty` is decisive.
   ⚠ Match on the message text, not the exit code — "already upstream" and a
   genuine conflict both exit non-zero.
2. **Subject match against the range.** A pick renames the SHA but preserves the
   subject. Weakest of the tests; say so when it carries a verdict.
3. **Per-file content compare.** If `main` is a SUPERSET of what the commit added,
   it is superseded, not missing.
4. **patch-id** — necessary, NOT sufficient. Correct for *"is my unmodified commit
   inside this range I just built"*, which is what CLAUDE.md mandates it for and
   which remains right. It fails only where the commit may have **evolved**
   between the two points compared.

## Reviving one

```bash
git log abandoned/2026-09-11/decision-os-waiver-slice-producer -1   # notes are in the tag
git worktree add --detach <tmp> origin/main
git cherry-pick d13c95f73        # expect conflicts; resolve with the author's intent, not a resolver
```

⚠ Do not auto-resolve a conflict set to one side. CLAUDE.md records a day where a
resolver correct five times inverted a deletion on the sixth.

## The branch these came from

Local `main` in the shared `F:` checkout was, when this was written, **261 commits
behind `origin/main` and 119 ahead**, diverged at `3bc906c84` on 2026-09-06, with
460 files differing. Most of the 119 are already on `main` under other SHAs.

**Neither obvious remedy is safe**: resetting it drops genuinely unlanded work,
and building on it yields a tree missing days of landed features. The rule that
avoids both: **build from `origin/main` in a detached worktree, never from local
`main`.** That is already the landing convention; it has to be the starting one
too, because `git diff`, `git log` and `git status` in that checkout all silently
answer about local `main`.
