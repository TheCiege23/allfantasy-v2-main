# League page: Sleeper tabs, page by page

Owner decisions, 2026-11-17. The league page (`app/league/[leagueId]/LeagueShell.tsx`) follows Sleeper's
tab layout (Matchup · Team · League · Trade · News · Settings) in each league type's own colours
(`lib/league/leagueTypeSkin.ts`, `components/league/league-type-skin.css`). For each Sleeper page the owner
said what to keep, change and add. Numbers match the review list.

"AF blue" is the existing token `--af-blue` (#3b82f6, `lib/draft-room/adpReadinessCopy.ts`).

| # | Page | Keep | Change / add |
|---|---|---|---|
| 1 | Matchup: head-to-head card | Layout as is | Add an **AF projected** line under the regular projection. Make the small text bigger: it is hard to read even on PC |
| 2 | Matchup: starters, bench, IR side by side | Layout as is | Use the **AF injury visuals** for IR / Out / Ques on both sides |
| 3 | Team: header | Header as is | Second projection line for **AF projection, in AF blue**. When the projection shows the user losing, the bar turns **neon red**. Make "Yet to play" bigger |
| 4 | Team: starters, bench, IR, taxi | As is | **BYE in AF blue**. Other sports: a player with no game shows **DO** (Day Off) / **NG**. Add the team's **future draft picks** at the bottom, for leagues that trade picks |
| 5 | League: all matchups | As is | For non-playoff teams (dynasty / c2c / devy especially): show the **projected rookie pick for next season**. It updates weekly from the commissioner's draft-order settings, unless the toilet bowl decides it |
| 6 | League: standings | As is | Add **future draft picks** here too |
| 7 | League: activity | — | Make it look better, and make sure **approved trades** are included |
| 8 | Trade: trade block | — | Restyle as **compact player cards** (two-column grid: position · team, short name, avatar, owner strip coloured by position) |
| 9 | Trade: propose a trade | Grid and filters | Add an **"Add to trade block"** button and a **favourite**, drawn as the **AF crest** rather than a heart (the crest carries an interest count). After choosing a manager, open the **proposed-trade window**: one Receives / Sends card per team (multi-team trades), with Review Trade Offer, expiry, send-DM toggle and Send Trade |
| 10 | News | As is | Add a **share-to-socials** button |
| 11 | Settings: My Settings | Everything | — |
| 12–15 | Settings: League Setup (general, waivers, roster, scoring) | Everything Sleeper has | Add **every AF league-specific option**: Survivor idols, odd-number manager counts, odd-number playoff fields with custom playoff settings, a commissioner-set **rookie draft order before the season** (dynasty / c2c / devy), the **keeper round** set before the league starts, and any AF option built later. Each one is ALSO in the Commissioner Hub |
| 16 | Settings: draft settings → **Commissioner Hub** | — | The Commissioner Hub lives here. One league: hub and settings match, and the hub carries more depth. **Connected leagues** (Survivor + Exile Island, a tournament with several leagues and drafts, a Zombie universe): the hub opens a pop-up with every connected league, for the decisions that span them (several drafts at once, several chops, toggles). **Storyline** and **Rivalry Week** settings live in the hub |
| 17 | Commissioner Tools: schedule | Everything | A **randomization count dropdown (1–25)**: the system runs that many randomizations one by one and posts each result to the **league chat**. **Custom matchups**. With **divisions**, mirror the real sport's in-division game count when the division count matches the sport's (AFC East plays its division twice; NBA conference counts). **"Copy" leagues**: managers take a real team's name and logo, and the commissioner can use that team's real schedule |
| 18 | Members: member settings | Everything | Add a **Chimmy lineup** toggle (Chimmy sets that team's lineup), and an **auto-switch for possibly-injured players** toggle with a dropdown when it is on |
| 19 | Members: commissioners, co-owners, remove, invite | Everything | — |
| 20 | Record Book: history, all-time standings, high scores | Everything | Add the core's visuals: the **Dynasty "The Rafters"** banner treatment (year pennants, champion names, "No banner of yours yet") |
| 21 | Record Book: stat corrections, League Legend | Content | Restyle to match the core's AF visuals |

## Answers (2026-11-17)

- #4: a player with no game that day shows **NG**, in every sport (BYE stays BYE for NFL).
- #16: "Commissioner Hub" **replaces the Commissioner Tools sub-tab**. Draft settings stay under League Setup.
- Scope: the colour skins and Sleeper-style tabs land as their own PR first. The rest follows in phases:
  - **A. Looks**: #1, #2, #3, #4 (BYE/NG), #7, #8, #10, #20, #21
  - **B. Data features**: #4 and #6 future picks, #5 projected rookie pick, #9, #18
  - **C. Commissioner Hub**: #12–17
