# Completed-trade validation — October 3, 2026

## Preserved grade replay

Read-only audit of production's `completed_trade_grade_v1` snapshots. No grade, quote, ledger or calibration row was written. The audit reads at most 5,000 snapshot rows and prints aggregate counts only.

| Check | Result |
| --- | --- |
| Snapshot rows read | 565 |
| Unique league/transaction originals | 562 |
| Malformed originals | 0 |
| Replayed original grades | 562 |
| Letter disagreements on preserved values | 0 |
| Mirror disagreements | 0 |
| Preserved more than 24 hours after execution | 442 |
| Execution date unavailable | 4 |

Original-side letters: A 185, B 68, C 82, D 63, F 164. These are stored orientations, not a distribution of randomly sampled managers. Replay uses preserved prices, not today's price book. The counts prove consistency with the shared grade rules; they do not prove that the letters predict future production or represent expert consensus.

Run `scripts/audit-completed-trade-grades.ts --db-host=<intended-host>` with the intended database environment. The host guard is mandatory. Manager names, league identifiers and individual trades are not printed.

## Completed-trade market estimator

The existing dry-run market recalculation considered 8,805 deduplicated transactions from 2024 onward and used 5,932. It excluded 1,784 with no players, 287 with a side worth zero and 802 containing an unpriced player. There were 446 players with observations and 346 candidate adjusted prices; **zero rows were written**.

The candidate median adjustment was +2.5% in the writer dry run (+2.4% in the diagnostic's lower-median convention). The existing centering gate failed. Candidate movements were 182 rising, 159 falling and 5 stable, frequently at the ±12% cap. This estimator is distinct from the analyzer's shared value-grade rules. Passing the replay does not validate publishing these adjusted prices.

## Calibration decision

Keep the current price-grade rules and original snapshots unchanged. Do not publish the candidate adjustments or label the displayed grade as empirically calibrated from this audit. Completed-only observations cannot calibrate acceptance probability, and historical transactions quoted with current prices cannot validate trade-day predictions. Most saved originals here were preserved after execution.

A predictive benchmark needs contemporaneous quote snapshots, a declared outcome horizon, complete tenure/starting-point coverage, and a held-out sample split by time and league. The same-day subset must accumulate outcomes before evaluating predictive quality. Expert agreement on a price grade requires independent judgments rather than treating acceptance as proof of fairness. No threshold or confidence change is justified by the evidence gathered in this audit.
