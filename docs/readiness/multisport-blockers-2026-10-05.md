# Multi-sport readiness follow-up — October 5, 2026

## College identities

Production: 445 of 465 distinct imported roster IDs resolve to a verified CFBD identity, with zero ambiguous resolved roster mappings. Twenty remain unresolved. Nineteen have no name in the current source directory or archived import; two occupy starter slots. The other is a prospective player absent from the current official roster. A fresh planner dry run proposed zero source or current-roster mutations. Missing names are not recovered from roster slot labels or guessed athlete matches.

## Advanced college scoring

The CFBD contract probe is complete; see contracts/cfbd/GAPS.md and both captured fixtures. The new endpoint is insufficient to certify all requested categories: explicit two-point, assisted-tackle and safety types are absent, and one independently documented forced fumble is absent from the capture. Existing scoring remains unchanged; no missing category is newly certified as zero.

## NCAAB

The production season import now holds 5,572 distinct game IDs over 123 day buckets, November 1 through March 7. These are provider listings, not a claim of 5,572 distinct physical games: mirrored opponent listings are present. No arbitrary home/away deduplication or timestamp correction is applied.

The regular season opens November 1 in Rome, one day before the domestic slate. The shared anchor is corrected from November 2 to November 1 so the actual opener belongs to week 1 for all consumers of the seven-day resolver. Tests prove an unfinished opener prevents finalization and adjacent weeks remain disjoint. This intentionally changes default NCAAB week windows to Sunday–Saturday. Explicit commissioner-supplied anchors continue to take precedence.

Sources: [Villanova regular-season announcement](https://villanova.com/news/2026/8/26/villanova-announces-mens-basketball-non-conference-slate.aspx), [official event page](https://www.villanova.edu/university/events/eternal-city-tip-off.html).

## NHL

The production finalizer dry run reports 43 listings, 39 final and four unfinished, with the last scheduled start October 6 at 00:00 UTC (October 5 at 8 p.m. Eastern). It correctly refuses with games_not_final and writes no finalized rows. All games must actually finish and the 12-hour grace period must pass. No clock, result or status is altered to manufacture readiness.

## Certification

NCAAB schedule publication and the CFBD capture access blockers are cleared. Full multi-sport readiness remains unverified pending missing source identities, a complete additional college-scoring feed, and completed NHL games. The mirrored NCAAB listings and provider date/time discrepancies also require source reconciliation before claiming a fully audited schedule.
