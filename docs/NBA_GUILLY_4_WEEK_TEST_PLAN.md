# NBA Guilly — 4-week test plan (4 managers)

What to check each week in the 4-manager NBA Guilly test league, so a problem shows up
in the test league and not in a paying commissioner's. Each line says what should
happen; if it does not, note the league, the week and roughly when.

**How an NBA Guilly week runs** (defaults, all editable in Guilly rules):
- Scoring week: Monday–Sunday.
- Chop: after the stat-correction wait (default **48 h** after the week's last game),
  which in practice is Tuesday night / Wednesday morning ET. Just before chopping, the
  week's stats are now pulled again, so a correction that landed inside the wait counts.
- Waivers: Thursday 7:00 AM ET, so everyone gets a day to bid on the chopped roster.
- One team is chopped per week: 4 → 3 → 2 → 1 by the end of week 3. Week 4 checks the
  finish and the season wrap-up.

> With 4 teams, decide the endgame before week 1 (Guilly rules → endgame): "Last team
> standing" ends after week 3; "Final two" stops chopping at 2 and adds a showdown.

---

## Week 0 — before the first game (commissioner)

- [ ] **Roster settings**: open them and press save once. This re-saves the settings
      that changed this month.
- [ ] **FAAB on chop**: set "A chopped team's unspent FAAB" to *Split it among the
      survivors*. This needs AF Commissioner; without the plan the option should show
      locked, with an upgrade prompt.
- [ ] **Stat-correction wait**: confirm it is set (48 h by default). "Immediate" skips
      the wait *and* the pre-chop stat refresh.
- [ ] **Chop preview**: "Preview this week's chop" shows all 4 teams, the chop line, and
      what each team's FAAB would become with the split on.
- [ ] **Integrity** (League settings → Commissioner → Competitive integrity):
      anti-tanking on, collusion sensitivity set, *Suspicious trade alerts* on.
      Open "Review integrity flags": the page loads and says no scan has run yet.
- [ ] **Chimmy commissioner alerts**: on (AF Commissioner).
- [ ] **FAAB budgets**: every team shows the same starting FAAB on the waiver screen
      *and* on the Guilly standings (these used to be able to disagree).
- [ ] **Phone**: open the league on a phone; bottom tabs and the "More" sheet work, and
      no duplicate tabs.

## Week 1 — first chop

During the week:
- [ ] **Lineups**: each manager sets a lineup. One manager deliberately benches a
      healthy starter for the integrity test (see "after the week closes").
- [ ] **Waiver claim with FAAB**: one manager wins a claim with a bid (e.g. $10).
      After the run, the winner's FAAB drops by $10 on the waiver screen, the Guilly
      standings, *and* when you ask Chimmy "how much FAAB does <team> have?". All three
      must agree.
- [ ] **Blind auction** (if on): a claim placed after the cutoff waits for the next
      run instead of being processed early.
- [ ] **A FAAB trade**: two managers trade $5 of FAAB plus a player. After it goes
      through:
  - [ ] both teams' FAAB moved by $5, and it matches everywhere (as above);
  - [ ] the integrity page now shows a **"Last scan"** time for collusion. This is the
        first scan that ever ran in production, so confirm it.
  - [ ] if the trade is lopsided enough to be flagged, the commissioner gets a
        "Potential collusion detected" notification.

After the week closes (Monday onward):
- [ ] **No chop before the wait is over**: on Monday the week shows as final but nobody
      is chopped yet.
- [ ] **The chop** (Tuesday night / Wednesday morning ET):
  - [ ] the lowest-scoring team is chopped and the chat announces it;
  - [ ] the chopped team's players show up on waivers;
  - [ ] the chopped team can no longer place claims;
  - [ ] with the split on, the chopped team's FAAB goes to 0 and the 3 survivors gain
        an even share, shown the same on the waiver screen, the standings and Chimmy.
        A chat line announces the split.
- [ ] **Chimmy chop recap** posts (AF Commissioner or AF Pro).
- [ ] **Tanking check**: the team that benched a healthy starter gets a
      "Potential tanking detected" flag on the integrity page (if Chimmy judges it
      suspicious) and the commissioner is notified. The flag shows up at most once
      per manager while it is open.
- [ ] **Waivers Thursday**: a claim on a chopped player processes at the Thursday run.

## Week 2 — corrections and commissioner tools

- [ ] **Stat correction**: if the NBA corrects a stat between Sunday and the chop, the
      chop uses the corrected number. To check: compare a player's box score on
      nba.com against his points in the league after the chop.
- [ ] **Commissioner FAAB edit**: change one team's FAAB by hand, then undo it. Both
      the edit and the undo show the same number on the waiver screen, the standings
      and in Chimmy.
- [ ] **Trade reversal** (optional): reverse the week-1 trade from the commissioner
      tools. Players and FAAB go back, and both FAAB numbers match.
- [ ] Second chop: 3 → 2, the same checks as week 1.

## Week 3 — the final chop (or the start of the final stage)

- [ ] **Last team standing**: 2 → 1. The winner is crowned and the season is marked
      complete.
- [ ] **Final two**: chopping stops at 2, the standings show the final-stage total, and
      nobody is chopped.
- [ ] The integrity page still loads, and its counts match the flags listed.

## Week 4 — wrap-up

- [ ] Final standings and the champion are correct.
- [ ] Chopped managers can still open the league read-only.
- [ ] No pending waiver claims, trades or notifications are stuck.

---

### If something is wrong

Write down: league name, week, what you saw, what you expected, and the time (with
time zone). Screenshots from the phone help. Paste it into a Claude session in this
repo; that is enough to find the right logs and code.

### Known limits (not bugs)

- Automatic stat-correction adjustments for **head-to-head** leagues are NFL-only. NBA
  head-to-head leagues are not re-checked yet; NBA Guilly is covered by the pre-chop
  refresh above.
- Collusion and tanking scans only run in leagues created in AllFantasy, not imported
  ones.
