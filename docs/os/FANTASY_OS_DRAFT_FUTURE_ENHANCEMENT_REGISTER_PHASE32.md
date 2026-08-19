# Future Enhancement Register (Phase 32)

Deferred, disclosed, non-blocking ideas surfaced across Phases 25-32. Not scheduled — a reference list for when real data or product priority justifies revisiting Draft OS in maintenance mode.

| Idea | Why deferred | Trigger to revisit |
|---|---|---|
| Player-level defensive stat differentiation (tackle-heavy vs big-play-heavy IDP value) | Requires real per-player projected defensive stats not currently threaded through the engine | Real IDP leagues appear in production with measurable recommendation complaints |
| Read `IdpLeagueConfig.scoringPreset`/`scoringOverrides` into the engine | 0 real leagues populate it; untestable today | A real league adopts a non-default IDP scoring preset |
| Real 2QB vs Superflex conflict handling (a league with both signals) | 0/65 real leagues exercise this edge case; current mutual-exclusion default (Superflex wins) is a reasonable but unvalidated judgment call | A real league is found with both a `SUPER_FLEX` slot and `QB:2` |
| Player-level receiving-role differentiation for PPR (pass-catching RB vs between-the-tackles RB) | Disclosed scope boundary since Phase 29; needs real target-share/reception data | Real per-player reception data becomes available to the engine |
| Reconcile `League.keeperCount`/`LeagueSettings.keeperCount` with `DraftSession.keeperConfig` | Three non-reconciled keeper config surfaces exist (Phase 30 finding); only one is read by live code | A real league's declared keeper intent (`League.keeperCount > 0`, 65 real leagues today) is found to silently fail to produce a real keeper draft |
| Real-time concurrent-draft-load validation | All Phase 25-32 validation used backtest/shadow/unit paths, never a live real-time draft room under concurrent load | Before any Draft OS logic change is trusted for a live, high-concurrency draft event |
| Organic (non-single-batch) ADP accumulation for IDP positions | Current 21 real CB entries appear to originate from one seed batch, not diverse organic draft history | Real IDP draft activity accumulates in production |
