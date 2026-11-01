# Zombie 2025 serum and weapon implementation

## Scope

This tranche applies the approved NFL 2025 item rules to new native NFL Zombie weeks. NFL score bands are not imposed on NBA, NHL or MLB. Those sports retain their earlier item policy pending a sport-specific calibration and acceptance pass. Historical sealed weeks keep their recorded policy; legacy shield inventory and incompatible winnings history require review rather than silent conversion.

## Implemented

- A Survivor or Whisperer may spend one or several serums for +10 each against a Zombie only. Actual saved weekly starters and stored game times establish the last-starter deadline. Bench players, byes, missing times and client-selected historical weeks cannot reopen it. Used serums are spent regardless of the final outcome.
- Ordinary weapons give automatic reusable bonuses: strongest two held Knife +4, Axe +6, Bow +8 or Gun +10. Zombies can hold them but cannot wield them. A bomb gives +35 once, replaces ordinary weapon bonuses that week, and uses the same last-starter deadline. The implementation permits one bomb per week.
- Native scoring writes item bonuses separately from unboosted team scores and individual player scores. Recalculation starts from player points and adds the saved bonus once. Item score receipts freeze when a team's last starter begins; a later trade retains the bonus already played. An item received after that deadline activates next week.
- NFL unboosted weekly score bands award exactly one weapon: 100–104.99 Knife, 105–109.99 Axe, 110–114.99 Bow, 115–119.99 Gun, 120+ Bomb. Awarded/looted weapons start next week, never retroactively change the finished week. Highest unboosted score earns a serum, including an eligible Whisperer; tied highest teams follow the existing tied-award convention. Survivor bashing a Zombie and Zombie mauling an opponent earn the combat serum.
- Loot follows sealed pre-resolution roles, inventory and accumulated winnings: one serum for a Survivor beating a Zombie/Whisperer; all serums for eligible Whisperer/Zombie wins; Zombie-v-Zombie serums only when all winnings are taken. Normal weapon theft requires a win without a weapon bonus and takes the highest eligible weapon. A Survivor cannot steal a bomb from another Survivor in ordinary loot. Bashing and mauling transfer all held items. Used items cannot be stolen; late-received unused items remain eligible loot.
- Loot, awards, mandatory revival and an item settlement receipt commit together, with conditional ownership/debit checks and bounded serializable retries. Repeat settlement returns the receipt. A Zombie automatically spends exactly two native serums to revive; it cannot revive in the week it was infected. Periodic housekeeping also catches eligible Zombies when a new week opens. Commissioner grants process eligible revival in their transaction.
- Armory controls show applied or equipped bonuses, serum quantity, equipped weapons, bomb use, success/rejection feedback and pending score-refresh status. A command request id prevents the same request from debiting twice. A saved consumption remains available to scoring retry if immediate refresh fails.
- Native trade proposals accept real `zombie_item` assets alone or bundled with players. Ownership, unused state and current Survivor/Whisperer roles are checked again inside settlement. Items move in the same transaction as players/FAAB, audit and an idempotent league chat receipt. The alternate pure trade runtime refuses inventory execution; it cannot record an imaginary item transfer. Player-only grades are withheld for item trades.
- Generated rules, commissioner settings and native inventory reporting reflect these mechanics. The native finalize endpoint uses the weekly orchestrator rather than the old warehouse award writer.

## Review and release limits

- Stat corrections on new item-policy weeks require full commissioner reconciliation; a winnings-only patch cannot silently leave wrong item awards, loot or roles behind. Automatic reversal of a trade containing items is held for complete reconciliation rather than reversing only its player/FAAB side.
- Bashing and mauling role-choice/succession, full multi-matchup ambush remaps and the Wednesday decision deadline are the next gameplay tranche. This item implementation does not certify those existing workflows.
- Unit/integration tests use controlled database doubles. They do not establish real PostgreSQL concurrency, provider scoring acceptance, live manager acceptance or physical iPhone behavior.
- No database migration is introduced here. The six migrations already on the branch still need production-specific verification.
- This candidate is not a production release. PR #2823 integration conflicts and the full-project compiler gate remain release work. No claim of 99% automation follows from these tests.

## Verification

Final test, lint, compiler and boundary-guard results are recorded after checking the final candidate. No error baseline or provider contract was changed.

## Remaining work

1. Complete bashing/mauling choices, succession and inherited ambush allowance, with Wednesday 9 p.m. Eastern defaults; implement full ambush remaps and team-specific locks.
2. Calibrate and accept the serum/weapon scoring policy for NBA, NHL and MLB without reusing NFL score thresholds.
3. Implement complete correction/reversal plans covering roles, inventory, scoring, winnings and dependent weeks; retain explicit review when external payments or later actions conflict.
4. Verify seasonal pots/distributions, replacements/proration, Ultimate Survivor carryover, exact commissioner voting and exception recovery.
5. Complete report/announcement delivery and field parity with the supplied weekly/universe examples; run authenticated real-manager/provider-window rehearsals for all four sports and physical iPhone acceptance.
6. Integrate current main, verify the existing migrations and production scheduling, resolve compiler/release gates and verify deployed assets/pages before declaring the update live.
