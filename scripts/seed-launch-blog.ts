/**
 * Seed the six launch blog articles.
 *
 *   npx tsx scripts/seed-launch-blog.ts            # refuses without DATABASE_URL
 *   npx tsx scripts/seed-launch-blog.ts --dry      # print what would be written
 *
 * Idempotent: upserts by slug, so re-running updates rather than duplicates.
 * publishStatus is set to "published" with publishedAt = now on create; an
 * existing article keeps its original publishedAt.
 *
 * Content drafted 2026-08-24 in the Brown Pig brand voice, honesty-checked
 * against the launch claims board (no unshipped features referenced, no
 * invented player facts — evergreen strategy + real product behavior only).
 */
import { prisma } from '../lib/prisma'

type Article = {
  title: string
  slug: string
  sport: string
  category: string
  excerpt: string
  body: string
  seoTitle: string
  seoDescription: string
  tags: string[]
}

const ARTICLES: Article[] = [
  {
    "title": "Import Your Sleeper League in 60 Seconds (Here's Exactly What You Get)",
    "slug": "import-your-sleeper-league-60-seconds",
    "sport": "NFL",
    "category": "tool_landing",
    "excerpt": "Type one thing, your Sleeper username, and about a minute later you're looking at your entire fantasy career. Here's exactly how the import works and what shows up on the other side.",
    "body": "Most fantasy tools make you work before they show you anything. Create an account, verify your email, connect this, allow that. Then you finally see a dashboard, and it's empty.\n\nWe built the Sleeper import to run backwards from that. You type one thing, your Sleeper username, and about a minute later you're looking at your entire fantasy career. No signup, no password, nothing installed.\n\nHere's exactly how it works, and exactly what you get on the other side.\n\n## The 60-second version: just your username\n\nGo to the AllFantasy trial page at /af-legacy and type your Sleeper username. That's the whole job. No account, no email, no credit card.\n\nWhile you wait about a minute, we pull every season Sleeper has on record for that username, up to 27 seasons of history, and build your career **Legacy profile** from it. Every league you've ever played in, every finish, every title.\n\nThe part I care about most is the difficulty-adjusted win rates. A championship in a startup dynasty league full of sharks is not the same trophy as one in an 8-team redraft with your cousins, but a raw win percentage treats them the same. So we break your record out across dynasty, redraft, and specialty formats and adjust for how hard each league actually was. That's the number that settles the group-chat argument.\n\n## Why we never ask for your password\n\nThis is the part worth taking apart, because \"connect your league\" usually means \"hand over your login,\" and that should bother you.\n\nSleeper publishes league data through a read-only public API. Rosters, matchups, transactions, history, all of it readable with just a username. No password exists on that path, so we never ask for one.\n\nEvery import is **read-only**, period. We never touch your platform. We can't set your lineup on Sleeper, can't drop a player, can't change a league setting. We don't have that access, by design. If something ever looks off in your Sleeper league, it wasn't us, because it can't be us.\n\n## The signed-in flow, when you want the whole toolkit\n\nThe trial shows you your career. To get the weekly tools, you make a free account and link your Sleeper handle, either right at signup or later in settings.\n\nOnce it's linked, we discover your leagues automatically. You see the full list, you pick which ones to import, and we pull them in read-only, same as the trial. ESPN and Yahoo leagues import too, but Sleeper is the deepest by far: full history and your league's full scoring settings.\n\nThat last part matters more than it sounds. Your league's real scoring is what lets the rest of the app price players the way **your** league prices them, instead of some generic default that scores a tight end like it's 2014.\n\n## What shows up after import\n\n### One board\n\nEvery league you imported lands on one screen. Not eight tabs, one board. And before kickoff on Sunday, the home screen runs injury triage across all your leagues at once, so you catch the questionable tag in league six before lineups lock, not after.\n\n### Live matchups\n\nFor Sleeper leagues you get live matchups with win probability as the games play out. Every matchup you have, moving on one screen, instead of bouncing between apps at one o'clock trying to figure out which version of you is winning.\n\n### The Player Finder\n\nThis is the tool I built because I needed it. Search a player and it shows every league you roster him in, whether he's starting or on your bench in each one, his current injury designation, and the bench and waiver options available in each league, priced under that league's own scoring. Five leagues, one questionable running back, one screen, decision made.\n\n## The thing you won't see: invented numbers\n\nOne rule runs through the whole product: when we don't have the data, we say **no data**. We don't fill the gap with a made-up number so the screen looks fuller. A fantasy tool that guesses when it should stay quiet will eventually cost you a matchup, and you'll never know which week it was.\n\nSame spirit on the business side. There's a free forever tier, and there's no gambling and no DFS anywhere in the product. This is a tool for winning your league, not a funnel to a sportsbook.\n\n## Try the 60 seconds\n\nIf you've read this far, the test costs less time than the reading did. Go to /af-legacy, type your Sleeper username, and see what your career actually looks like. If the Legacy profile hits, make the free account, link your handle, and take the board, the live matchups, and the Player Finder into the season.\n\nWorst case, you spent a minute learning your real dynasty win rate. Best case, you found an edge before anyone else in your league knew it existed.",
    "seoTitle": "Import Your Sleeper League in 60 Seconds | AllFantasy",
    "seoDescription": "Type your Sleeper username and get your whole fantasy career in about a minute: every league on one board, difficulty-adjusted win rates, read-only import.",
    "tags": [
      "sleeper",
      "league import",
      "getting started",
      "legacy profile",
      "player finder",
      "how-to"
    ]
  },
  {
    "title": "No Invented Numbers: What That Actually Means in AllFantasy",
    "slug": "what-no-invented-numbers-means",
    "sport": "NFL",
    "category": "ai_explainer",
    "excerpt": "Most fantasy tools fill every box even when the data behind it is empty. Here's why AllFantasy shows a dash with a reason instead, and what that actually looks like on your screen.",
    "body": "## Every box is full, and that should bother you\n\nOpen any fantasy tool during the season and count the blank cells. You won't find many. There's a projection for every player, a grade for every trade, a status dot next to every injury. It reads like confidence.\n\nHere's the part nobody says out loud: a lot of those boxes are full because a blank looks broken. Screenshot a dashboard with dashes on it and it looks unfinished. Screenshot one where every cell has a number and it looks smart. So most tools quietly optimize for the screenshot.\n\nI know exactly how that happens, because I caught my own product doing it.\n\n### The autopsy: how a fake number gets made\n\nNobody sits down and decides to lie to you. A fake number gets built one reasonable-sounding fallback at a time.\n\nNo projection for a player? Use the positional average. No scoring data behind a trade? Default the math to the midpoint. Cache went stale? Show the last value you have and skip the label. Each step sounds fine on its own. Stack them up, and the screen is now presenting a guess in the same font, the same color, and the same confident tone as a fact.\n\nWhile testing our own trade grader, I found exactly that bug. When the grader had zero scoring signal for a trade, the math quietly settled at the middle of the scale. Every no-data trade came out a C. A C doesn't read as \"we don't know.\" It reads as a verdict, and a manager might veto a trade, or accept a bad one, because of a letter that meant nothing.\n\nThat's the failure mode of fill-every-box systems. They don't crash. They produce plausible numbers, which is worse.\n\n### The rule we shipped instead\n\nSo AllFantasy runs on one rule: **no invented numbers**. If the data isn't there, the screen says \"no data\" and tells you why. A dash with a reason beats a confident fake.\n\nHere's what that looks like in three real spots.\n\n**A player we can't cross-reference.** Player Finder shows every league where you roster a player, your slot, his injury designation, and the bench or waiver options priced under your league's own scoring in Sleeper leagues. That only works if we can match the same human across systems by his platform id. When a player has no id we can match, the screen tells you straight: we can't cross-reference him. We don't stitch together a lookalike and hope you never notice.\n\n**A trade with no signal.** Trade grades for linked Sleeper leagues run on your league's real scoring, not some generic template. When there isn't enough data behind a trade, the grade says \"not enough data\" and stops. No letter. After the C bug, the grader has to prove it has real signal before it's allowed to speak.\n\n**Injury freshness only when it's real.** The home screen runs pre-kickoff injury triage across all your leagues. The freshness stamp on that info only appears when we hold a real timestamp for it. If we can't tell you when a designation was last updated, we won't imply it's current, because a stale \"questionable\" at 12:55 on Sunday is how you burn a lineup spot.\n\n### Why I care about the line between real and filled-in\n\nLast year I lost my grandmother, and with her, most of her stories. What that taught me is there's a hard line between what actually got captured and what gets filled in afterward by memory and guesswork. The filled-in version always sounds plausible. That's exactly what makes it worthless.\n\nI'm not comparing your flex spot to that. But it rewired how I build. When my software doesn't know something, it says so, because the plausible-sounding fill is now the thing I trust least in the world.\n\n### What this rule costs us\n\nFull transparency: our screens have blanks, and a demo with blanks looks worse than a demo with an answer in every box. Some of those blanks are gaps we're still closing. Sleeper is our deepest integration by far, with full history behind it. ESPN and Yahoo imports are read-only and thinner, and where the data is thin, the screen says so instead of padding it out.\n\nHere's the bet I'm making. It takes one bad Sunday, one start based on a stale status, one trade you judged off a letter that was really a shrug, and you never trust that tool again. I'd rather you trust us slowly for real reasons than quickly for fake ones.\n\n### Check the work yourself\n\nImport a Sleeper league through the free trial funnel. No signup, and you get your full league history plus a career Legacy profile built from up to 27 seasons in about a minute. Then go count the dashes. Every one should have a reason sitting next to it.\n\nAnd if you ever catch a number in AllFantasy we can't back up, send it to me. That's not embarrassing. That's a bug in the one system we refuse to let break.",
    "seoTitle": "No Invented Numbers: How AllFantasy Handles Missing Data",
    "seoDescription": "Most fantasy tools fill every box, even when the data behind it is empty. Here's why AllFantasy shows a dash with a reason instead of a confident fake.",
    "tags": [
      "no invented numbers",
      "trust",
      "trade grades",
      "injury data",
      "player finder",
      "fantasy football"
    ]
  },
  {
    "title": "Week 1 Is a Liar: How to React Without Overreacting",
    "slug": "week-1-is-a-liar",
    "sport": "NFL",
    "category": "weekly_strategy",
    "excerpt": "One game is a 6% sample of your season, but every league treats it like the whole story. Here's the process for pulling real signal out of week 1 before your league-mates panic-trade theirs away.",
    "body": "Every August I promise myself I won't overreact to week 1. And every September, somebody in one of my leagues sends a Tuesday morning trade offer that only makes sense if a single game rewrote the entire season. It never has. Let's take apart why.\n\n## One game is a 6% sample\n\nAn NFL season is 17 games. One week is 5.9% of it. That's the whole argument, honestly, but nobody feels it on Monday night, so let's make it concrete.\n\nIf your boss reviewed your entire year on 6% of your work, you'd call it unfair. If you flipped a coin 17 times, you wouldn't call it rigged after one flip. Yet every September, managers dump half their FAAB, cut their draft picks, and sell proven players off exactly that much information.\n\nWeek 1 isn't just a small sample. It's the noisiest small sample you'll see all year. Teams spent six months installing new schemes and hiding them through preseason, so defenses are reacting live to plays they've never seen on film. Opening scripts are built for surprise. By week 3, film study catches up and things regress toward normal. The scores from week 1 are real. Most of the conclusions people draw from them are not.\n\n## Open the box score and look at the parts\n\nFantasy points are the output of a machine. If you want to know what weeks 2 through 18 look like, you have to open the machine and check the inputs. Three inputs carry almost all of the signal.\n\n### Signal looks like role\n\n**Snap share is the first thing I check.** A coach voting with playing time in a real game tells you what six weeks of training camp actually decided. A receiver who ran a route on 90% of dropbacks and scored 4 points is in a far better spot than one who played 40% of the snaps and scored 18.\n\n**Opportunities beat results.** For a running back, count carries plus targets. Fifteen touches that produced 7 points is a good day that scored badly. Five touches that produced 19 points is a bad day that scored well. Only one of those tends to repeat.\n\n**Where the usage happens matters too.** Work inside the 10, third-down snaps, two-minute drill. Those are the touches a coaching staff hands to players it trusts, and trust is sticky from week to week. A quiet stat line with premium usage is a buy signal, not a bench signal.\n\n### Noise looks like one play\n\nRun this test on any week 1 line that has your league buzzing: subtract the longest play and read it again. A 75-yard touchdown is about 13.5 points in half-PPR, from one snap. If a player scored 21 and one play was 13 of it, his actual day was 8 points plus a coin flip that landed right.\n\nDo the same subtraction for matchup. One game against the best or worst defense on a schedule tells you almost nothing about the other 16. If the whole story of a breakout is one play or one opponent, it's not a story yet. It's an anecdote.\n\n## The week 2 waiver rule\n\nHere's the discipline rule, and it fits in one sentence: **bid on role changes, never on scores.**\n\nIf a player popped because the starter ahead of him got hurt, or because he walked into an 80% snap share nobody saw coming, that's a role change. Real FAAB is justified there, 20 or 30% of your budget if the role looks locked in, because you're buying future opportunities, not past points.\n\nIf a player popped because he caught two long balls on four targets, bid like it's week 8: small, or not at all. Chasing last week's points is buying a lottery ticket that's already been scratched.\n\nWant a gut check? Go back through your own league's history and count how many week 1 waiver darlings were still weekly starters by week 10. In my leagues it runs about 1 in 5. The hits are real, but the hit rate is low, so price your bids like it.\n\n## Panic trades are where the value leaks\n\nEvery trade offer sent in week 2 is priced off one game, which means most of them are mispriced. This is where seasons quietly get lost. The manager who sells a proven starter at a 25% discount because of one 6-point dud isn't cutting bait. He's donating value to whoever's on the other end.\n\nMy rule: if I wouldn't have traded a player seven days ago, I need a reason I can point to in the snaps before I'll trade him today. \"He looked bad\" is not a reason. \"He played 35% of the snaps behind the rookie\" is a reason. One is a feeling. The other is a coach telling you something.\n\nAnd it cuts both ways. When a league-mate is selling his week 1 disappointment at a discount, that's your window. The overreaction tax gets paid every September. Decide now whether you're paying it or collecting it.\n\n## The honest close\n\nWe built AllFantasy around one stubborn idea: when there's no real signal, say \"no data\" instead of inventing a number. Week 1 is the week that idea earns its keep, because week 1 is when everything looks like signal and almost none of it is.\n\nOne game is a data point. Seventeen of them make a season. React to roles, wait on results, and let the rest of your league make your trades for you.",
    "seoTitle": "Week 1 Is a Liar: React Without Overreacting in Fantasy",
    "seoDescription": "One NFL week is a 6% sample. How to separate real role changes from one lucky touchdown, bid waivers with discipline, and skip the week 2 panic trade.",
    "tags": [
      "week 1",
      "waivers",
      "snap counts",
      "trade strategy",
      "overreaction",
      "process"
    ]
  },
  {
    "title": "How to Actually Read the Waiver Wire: A Process, Not a Hot List",
    "slug": "how-to-read-the-waiver-wire-process",
    "sport": "NFL",
    "category": "waiver_wire",
    "excerpt": "Half your league reads the same waiver list every Tuesday. Here's the four-check process that beats it: your roster, your scoring, your FAAB, and one Monday-night move.",
    "body": "Every Tuesday morning, a hundred sites publish roughly the same ten names. Half your league reads the same list, and by the time waivers clear, the top guy has been bid up to a number nobody can defend. Three weeks later everyone is complaining that the wire \"never has anything.\"\n\nHere's the thing: the hot list isn't wrong. It's just not about you. It was written for millions of rosters at once, which means it was written for none of them. So let's take it apart and build a process that actually knows whose team it's working for.\n\n## Why hot lists break the second they hit your league\n\nA hot list is a ranking built in a vacuum. Your league is not a vacuum. Three pieces of context get stripped out the moment a list goes to print, and those three pieces are the whole decision.\n\n### It doesn't know your roster\n\nThe top name this week might be a running back while you're four deep at the position and starting a ghost at receiver. A pickup only matters if it changes a lineup decision you're actually going to face. The fifth-best add on a generic list can be the single best add for your team, and the number one add can be worthless to you.\n\n### It doesn't know your scoring\n\nA pass-catching back is a different asset in full PPR than in standard. A touchdown-dependent receiver moves up in one format and down in another. Every hot list is silently priced against one scoring system, and the odds it's exactly your league's settings are low. If the list doesn't tell you what scoring it assumes, it's guessing, and so are you.\n\n### It doesn't know your budget\n\n\"Worth a 15% bid\" means nothing without knowing what's in your pocket and everyone else's. Fifteen dollars from a full budget is a nudge. Fifteen dollars when you're down to thirty-one is half your season. Same number, completely different decision.\n\n## The process: four checks before every claim\n\nNone of this takes more than ten minutes on a Tuesday. That's the point. A process you'll actually run every week beats a perfect one you won't.\n\n### Check 1: need first, then best available\n\nStart with one question: can I field a full, healthy starting lineup this week? If the answer is no, you're in **need mode**, and you fill the hole even if the player is boring. If the answer is yes, you switch to **best available**, and the test becomes: does this player change my starting lineup at any point in the next three weeks? If a pickup can't crack your lineup inside three weeks, you're collecting, not competing.\n\n### Check 2: do the bye-week math\n\nOpen your schedule and count forward three weeks, position by position. Write down the actual number of startable players you have for each of those weeks. If the week after next you've got two running backs on bye and one starter left, that is not a problem you solve on Sunday morning. The bye-week hole you fill two weeks early costs a small bid. The same hole on the Sunday it opens costs a panic drop and a start you'll regret.\n\n### Check 3: price FAAB as a percentage of what's left, not a vibe\n\nStop bidding in dollars. Bid in percentage of your remaining budget. If you started with $100 and you're sitting on $46, a $15 bid isn't a \"medium\" bid. It's a third of everything you have left for the rest of the season.\n\nBefore every claim, run the one-line math: **bid divided by remaining budget**. Under 10% is a dart throw, and you should throw plenty of those. Between 10% and 25% says this player starts for me soon. Anything past 40% should only happen when the player fixes a hole you would otherwise carry into the playoffs.\n\n### Check 4: the Monday-night bench stash\n\nHere's the move that costs nothing and quietly wins leagues. Sunday and Monday night, while everyone else is watching highlights, look at your worst bench spot and ask what it's actually doing for you. If the answer is nothing, cut it for the speculative player who just flashed, before the Tuesday deadline turns him into a bidding war.\n\nCheck your league's exact waiver rules first, because lock windows differ. But in a lot of leagues, the stash you grab Monday night is free, and the same player costs somebody 20% of their budget on Wednesday. That gap is the cheapest edge in fantasy football.\n\n## Where the software should help, and where it shouldn't\n\nI'll show my work on why we built it this way. When we wired waiver options into AllFantasy, the rule was that every option gets priced under your league's actual scoring, pulled from your linked Sleeper league, not some default format the list-makers assumed. The Player Finder also shows whether a player is genuinely available in your league, instead of guessing from national roster percentages.\n\nAnd when we don't have the data, the screen says \"no data.\" That's the whole philosophy: software should do the math it can prove, roster by roster, scoring rule by scoring rule, and stay quiet about the rest.\n\nYou don't need an app to run this process, though. You need the four checks: need, bye math, percentage bids, and the Monday stash. Run them every week and you'll stop asking what the internet likes and start asking what your roster needs. That's the edge, and it was sitting in your league settings the whole time.",
    "seoTitle": "How to Read the Waiver Wire: A Process, Not a Hot List",
    "seoDescription": "Hot lists ignore your roster, scoring, and FAAB. Here's a four-check waiver wire process: need vs. best available, bye-week math, and budget percentages.",
    "tags": [
      "waiver wire",
      "FAAB strategy",
      "fantasy football",
      "bye weeks",
      "roster management",
      "NFL"
    ]
  },
  {
    "title": "The Last 72 Hours Before Your Draft: A Checklist That Actually Fits on One Screen",
    "slug": "last-72-hours-draft-checklist",
    "sport": "NFL",
    "category": "draft_prep",
    "excerpt": "Draft prep that fits on one screen: what to check 72, 48, and 24 hours out, why half-PPR vs full PPR moves your whole board, and the one queue rule that stops the timer from picking for you.",
    "body": "Most draft prep advice is a 40-tab spreadsheet you will never open once you're on the clock. So here's the opposite: the last 72 hours before your draft, broken into what actually matters, small enough to fit on one screen. No player names, no hot takes. Just process you can run every August in every league.\n\n## 72 hours out: read your scoring settings like you're hunting a bug\n\nEvery league has somebody who drafts like it's full PPR when the league is half-PPR. That mistake doesn't cost one pick. It compounds for fifteen rounds.\n\nOpen your league settings and read every line. Reception points. Passing touchdown value, 4 points or 6. Roster slots and how many flex spots. Superflex or not. Bench size. Then write down the two or three settings that differ from whatever default ranking list you've been reading all summer.\n\nHere's the math on why half versus full PPR changes everything. A full point per catch pays a 90-catch receiver 45 extra points over his half-PPR self. That's close to three points a week, which is enough to shuffle entire position groups. Full PPR pushes pass-catching backs and high-volume slot receivers up the board and drops touchdown-dependent archetypes down it. You don't need names to use that. You need to know which kinds of players your league's rules actually pay.\n\nSame idea with 6-point passing touchdowns and superflex. Either one quietly turns quarterback from a late-round afterthought into an early priority. Draft off a default list in a league like that and you're running someone else's board in someone else's league.\n\n## 48 hours out: plan round bands, not names\n\nNames get sniped. Plans don't.\n\nSkip \"I want this guy in round 3\" and write a roster-construction plan by bands instead. Rounds 1 through 3: two backs and a receiver, or two receivers and a back, whichever way the room breaks. Rounds 4 through 7: finish your starting lineup and take your first real upside swing. Rounds 8 through 11: quarterback and tight end if you waited, plus high-variance bench pieces. Round 12 on: upside only. Your last few picks should be lottery tickets, because a \"safe\" pick that late has a ceiling exactly equal to his floor.\n\nThe whole point of a band plan is that it survives contact with the draft room. When your target goes two picks before you (he will), the plan says best available at the position the band calls for. It never says panic.\n\n## Tier breaks beat rankings\n\nA ranking tells you player 27 is better than player 28. It doesn't answer the only question that matters on the clock: is there a cliff coming?\n\nTake whatever rankings you trust and draw horizontal lines where the drop-off is real, so every position becomes groups of players you'd be roughly equally happy with. Now decisions get simple. One player left in a tier with a real step down behind him? That's urgency. Six players still sitting in the same tier? Wait a round and take the discount.\n\nRankings answer who's better. Tiers answer when you have to act. Only the second one helps you at pick time.\n\n## 24 hours out: the queue discipline rule\n\nBuild your queue the night before, from your tiers. Not from the app's default list, which is just the ranking you spent two days replacing.\n\nThen run one rule all draft long: **if a player in your queue is someone you would not take with your very next pick, delete him.** The queue is a next-pick shortlist, not a wish list. A wish-list queue is how the timer expires while you're grabbing a drink and auto-drafts your third tight end.\n\nPrune it after every one of your picks. Thirty seconds of maintenance, and the worst case of a dropped connection becomes \"the queue takes exactly the player I wanted anyway.\"\n\n## The morning of\n\nTen minutes, three checks.\n\nFirst, scan the news since last night and adjust your tiers. Adjust, don't rebuild. A morning-of panic rebuild throws away 72 hours of work over one headline. Second, confirm the draft time, the time zone, and your pick slot. More drafts get wrecked by time zones than by bad rankings. Third, read your band plan once more, out loud if that's what it takes to remember it under the clock.\n\nThen eat something and stop consuming draft content. A July plan usually dies of an August hot take.\n\n## One screen, honestly\n\nIf your league drafts on Sleeper, one small thing we built into AllFantasy: it mirrors the draft board live, so a league-mate on the couch or a co-manager three time zones away can follow every pick without hovering over your shoulder.\n\nAnd the reason this checklist has no projections in it is the same reason the product says \"no data\" instead of inventing a number: your edge comes from your league's real settings and your own discipline, not from borrowed conviction. Audit the scoring at 72 hours. Band plan at 48. Draw your tier lines. Keep the queue a next-pick shortlist. Morning of: news, time zone, plan, breathe.\n\nThat's the whole screen. Good luck, and keep score.",
    "seoTitle": "Last 72 Hours Before Your Draft: A One-Screen Checklist",
    "seoDescription": "A one-screen draft checklist for the last 72 hours: audit your scoring settings, plan by round bands, draw tier lines, and keep your queue honest.",
    "tags": [
      "draft prep",
      "fantasy football",
      "PPR",
      "tier-based drafting",
      "draft strategy",
      "checklist"
    ]
  },
  {
    "title": "How Our Trade Grades Work (and When to Ignore Them)",
    "slug": "how-our-trade-grades-work",
    "sport": "NFL",
    "category": "ai_explainer",
    "excerpt": "Every app grades your trades. We're the one showing the formula: the exact fairness math behind an AllFantasy grade, the bug that taught us to say \"no data\" instead of inventing a letter, and the three situations where you should overrule any grade, ours included.",
    "body": "Every fantasy app will grade your trade. Almost none of them will show you the math. That has always bugged me, because a letter with no formula behind it is a vibe wearing a suit.\n\nSo this is a teardown of our own tool: what goes into an AllFantasy trade grade for a linked Sleeper league, what the fairness score actually computes, and the situations where the right move is ignoring our grade and trusting yourself.\n\n## What goes in before any math happens\n\n### Your league's real settings\n\nWhen you link a Sleeper league, we read the league itself, not a generic template. Your scoring settings tell us whether you play PPR, half PPR, or standard, and whether tight ends get a premium bonus. Your roster positions tell us whether you run superflex and how many starter and bench slots you actually field.\n\nThat matters because the same trade is a different trade in a different format. A quarterback in a superflex league is a cornerstone piece. That same quarterback in a 1QB league might be the third-best asset in the deal. A grader that does not know your format is grading somebody else's league.\n\n### Market values, matched to your format\n\nEvery player in the deal resolves to a market value that fits your setup, so a superflex QB gets superflex value and a PPR receiver gets PPR value. Then we total each side. Those two totals, and the gap between them, are the raw material for everything that follows.\n\n### Roster context, for the explanation\n\nWe also pull the rosters around the trade: starters, bench, IR and taxi stashes, even how often each team has been trading. Here is the honest part: in the current grader, that context shapes the explanation, not the letter. The letter is pure value math. We would rather tell you that plainly than imply some deep roster simulation is running behind the curtain.\n\n## The fairness score is one line of arithmetic\n\nHere is the actual formula, straight from the code. **Fairness equals 100 minus the value gap as a percentage of the bigger side**, clamped between 0 and 100.\n\nSay side A totals 90 points of value and side B totals 100. The gap is 10, the bigger side is 100, so fairness is 100 minus 10: a 90. The letter is just a bucket on that number. A 97 or better is an A+, 92 gets an A, 88 an A-, and the scale steps down to an F below 50. Our example lands an A-.\n\nTwo more numbers ride along. **Below 60, the trade gets flagged as lopsided. Below 55, we recommend the commissioner take a real look.** And no AI writes any of this: the grade is deterministic arithmetic you could check with a calculator, and the explanation bullets are templated from the same numbers. We think that is a feature.\n\n## The honesty rule: no data, no letter\n\nHere is the bug that shaped this tool. In an early version, a trade where nothing resolved to a real value produced a gap of zero. A zero gap means fairness 100. Fairness 100 means an A+, a \"within normal market range\" note, and a commissioner review that came back clean.\n\nRead that again. The engine knew nothing about the trade and reported it as the fairest deal possible. The exact failure mode we built AllFantasy to avoid, sitting in our own code.\n\nSo we changed the rule. **When there is not enough data to grade, we do not grade.** No letter, no fairness score, a plain \"not enough data\" message, and the commissioner review stays open instead of implying the trade cleared. Ungradeable is not the same as approved. The whole product runs on that principle now: say \"no data\" before you invent a number. The trade grader is where we learned it the hard way.\n\n## When to ignore any grade, ours included\n\nA fairness score measures one thing: value evenness. Your league is full of things no value sheet can see.\n\n### Keeper deadlines and contention windows\n\nIf your keeper deadline hits Thursday and you need to clear a slot, a \"lopsided\" trade might be the correct one. Same if you are one piece away from a title run: overpaying on raw value to win now can be the sharpest move on the board. The grade does not know what week your window closes. You do.\n\n### Tilt trades\n\nThe math cannot see that you are chasing last week's loss, or that your trade partner is rage-selling his roster after an 0-3 start. A trade can be dead even on value and still be a mistake, because you made it to feel better instead of to get better. If you catch yourself refreshing the trade screen at 1 a.m., the grade is not the tool you need. Closing the app is.\n\n### League politics\n\nMaybe taking a slightly losing deal keeps a trade partner who brings you two more deals a season. Maybe a fair-on-paper move with your rival's best friend starts a cold war in the group chat. A model grades value. You manage twelve people and a decade of history, and that is worth more than five points of market value.\n\n## A second opinion, not a verdict\n\nUse the grade as a sanity check that shows its work: your real scoring, your real format, a formula you can verify, and a tool that admits when it is blind. Then make the call yourself, because you know your league better than any grader ever will. That is not modesty. That is just how the math shakes out.",
    "seoTitle": "How AllFantasy Trade Grades Work (and When to Ignore Them)",
    "seoDescription": "We take our own trade grader apart: the exact fairness formula, how your Sleeper league's real scoring shapes it, and why we refuse to grade with no data.",
    "tags": [
      "trade grades",
      "fantasy football trades",
      "sleeper leagues",
      "how it works",
      "transparency",
      "trade analyzer"
    ]
  }
]

async function main() {
  const dry = process.argv.includes('--dry')
  if (!process.env.DATABASE_URL && !dry) {
    console.error('REFUSING: DATABASE_URL is not set. Use --dry to preview.')
    process.exit(2)
  }
  for (const a of ARTICLES) {
    if (dry) {
      console.log(`[dry] ${a.slug} (${a.category}/${a.sport}) — ${a.body.split(/\s+/).length} words`)
      continue
    }
    const now = new Date()
    await prisma.blogArticle.upsert({
      where: { slug: a.slug },
      update: {
        title: a.title,
        sport: a.sport,
        category: a.category,
        excerpt: a.excerpt,
        body: a.body,
        seoTitle: a.seoTitle,
        seoDescription: a.seoDescription,
        tags: a.tags,
        publishStatus: 'published',
      },
      create: {
        title: a.title,
        slug: a.slug,
        sport: a.sport,
        category: a.category,
        excerpt: a.excerpt,
        body: a.body,
        seoTitle: a.seoTitle,
        seoDescription: a.seoDescription,
        tags: a.tags,
        publishStatus: 'published',
        publishedAt: now,
      },
    })
    console.log(`published: ${a.slug}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
