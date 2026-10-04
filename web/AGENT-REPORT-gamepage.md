# Agent report: gamepage (presentation pass, round 2)

## What I built

1. **Three states for the game page.** `game.status` now drives both section order and what starts open.
   - Pregame: Why watch, Written report, Where the game gets decided, Draft radar open; Keep an eye on, Live (opens at kickoff), Team style, Conditions, Market, Storylines, Beat feed, Score collapsed.
   - Live: header carries the live score, clock, down and distance, last play and the LivePoller. Order: Live (LivePanel plus box leaders), Pregame call scorecard, Draft radar (with in-game lines and last plays), then everything else collapsed.
   - Postgame: header with final score (loser dimmed). Order: Grade card, Written report, Who showed up (ESPN panel, box leaders, Did it play out), What we called (each matchup card shows the verdict pill and the actual box line next to the call; the pressure point shows its verdict; the projection box shows Projected vs Actual side by side), then the rest collapsed.
2. **Collapsible sections.** `src/components/Section.tsx` wraps every section in a native `<details>`: chevron, eyebrow, title, one-line summary in muted text. Works with no JavaScript. `src/components/JumpOpener.tsx` (tiny client component) opens the target section on load, on hashchange and on a jump-bar click, including a closed ancestor when a deep anchor is used. Summaries come from `src/lib/summaries.ts`, all derived from Game data (examples seen tonight: "ALA -5.5, total 62, model leans ALA by 2.3, under by 3.5"; "6 draft-eligible names, 2 future names, led by Antwan Raymond (RB, Day 3 range)"; "IU 23, RUTG 0, Halftime, RUTG ball 4th & 18 at RUTG 33"). A summary that only repeats the title is dropped.
3. **Grade card** (`src/components/GradeCard.tsx`): one paragraph built only from `game.archive`: "We said Youngstown State by 4.0 at 60%. Youngstown State won 28 to 16, winner right and the margin was off by 8. No matchup call could be graded from the box score. Beau Brungard, Ben Fiegel showed up. Side did not cover, total went under on 64.5, no lean to grade." plus four tiles. Ungraded archive: "Grading when the box score posts." No archive: says so plainly.
4. **Pregame scorecard for live games** (`src/components/PregameScorecard.tsx`): winner, side, total (on-pace total from the ESPN clock once 10 minutes have elapsed), and each locked matchup call as rows. Status pills say holding / behind / so far / pending; the footer says these are the current score against the call, not a grade. Matchup rows show the live leader line for the offense in question (CFBD box, else the ESPN summary leaders) because the in-game feed has no team totals; passing-downs rows say they are graded from play-by-play after the final.
5. **Residue cleanup.** Report evidence ids are behind "Show evidence" (`WrittenReport.tsx`, additive `embedded` prop so the page's Section owns the headline). Projection basis lines and the model notes sit under "How this was computed". Matchup evidence strings sit under "Evidence". The coverage gaps box is one muted line with expand. Did-it-play-out tiles hide when nothing was graded. `/draft` no longer shows "Jr, undecided"; it shows "Returning" only when that decision is set (Declared was already there). `/history` already hid 0/0 badges (another agent).
6. **Nav.** Six primary tabs stay. `More` is a dropdown on desktop and a compact icon-only seventh slot at the right end of the mobile tab bar that opens a sheet above the bar. More holds Ask, Feed, Track record (`/backtest`), Sheet (`/sheet`), Plan (`/plan`), My board (`/board`). Active state: More lights up when any of its routes is current. Closes on outside tap, Escape and route change. The `/board` and `/plan` entries another agent had added to the primary list moved into More so the bar stays at six.
7. **Mobile header** (`src/components/GameHeader.tsx`): two-row scoreboard (logo, rank, name, score on the right, green while live), one meta line (division, kickoff, network, status), venue line, Scout Score as an inline badge, Watch / Share / team-follow chips using abbreviations. Everything fits one 390 x 844 screen in all three states.

## Files touched
- `src/app/game/[id]/page.tsx` (rewritten; all other agents' additions kept: generateMetadata, ShareButton, WatchGuide/guide, lastPlays, ProspectCard grade/note, BeatFeed pos)
- `src/app/layout.tsx` (NAV trimmed to six, MORE list added, icons)
- `src/components/NavLinks.tsx` (More dropdown and mobile sheet)
- `src/app/globals.css` (section, fold, tab-bar More, menu styles appended)
- `src/components/WrittenReport.tsx` (additive: `embedded` prop, Show evidence fold)
- `src/app/draft/page.tsx` (one line: Returning chip replaces Jr, undecided)
- New: `src/components/Section.tsx`, `JumpOpener.tsx`, `GameHeader.tsx`, `GradeCard.tsx`, `PregameScorecard.tsx`, `src/lib/summaries.ts`

## How to verify
- `npx tsc --noEmit` passes; `npx eslint` is clean on every file above.
- Screenshots (headless Chrome against `next dev -p 3077`, phone shots through a 390px iframe because headless Chrome will not go under about 500px wide):
  - `qa/gamepage/after-pre-desktop.png`, `after-pre-390.png`, `after-pre-390-fold.png` (Baylor at Arizona State, 401856817)
  - `qa/gamepage/after-live-desktop.png`, `after-live-390.png`, `after-live-390-fold.png` (Indiana at Rutgers at halftime, 401858477)
  - `qa/gamepage/after-final-graded-desktop.png`, `after-final-graded-390.png` (Youngstown State at Southern Illinois, 401867891, graded)
  - `qa/gamepage/after-final-ungraded-desktop.png` (Alabama at Mississippi State, 401856707, no locked call)
  - `qa/gamepage/after-nav-desktop.png` (More active on /ask), `after-home-390.png` (tab bar with More)
  - "Before" screenshots were lost: the first batch was written with relative paths that headless Chrome resolved elsewhere. The before state is the previous build on PM2 port 3000.
- Open any final game: grade card first. Open a live game: live panel, then the scorecard. Click a jump-bar link to a closed section: it opens and scrolls.

## Known gaps
- Live matchup rows show "pending" until a leader line exists in the CFBD box or the ESPN summary for that unit; Indiana at Rutgers had neither at halftime through the ESPN summary we had cached.
- The on-pace total uses the ESPN period and clock; overtime is clamped to 60 minutes.
- `opengraph-image.tsx` (another agent) logs "No fonts are loaded" on every game page request in dev. Not mine, but it is noisy.
- Section open state is not remembered between visits (native details, no storage). Easy add with localStorage if wanted.

## Ideas
- A "Flip to" strip on live pages: the scorecard already knows which calls are holding; a one-line "the Indiana run-game call is the one to watch, 14 carries for 88 so far" would pull the fan to the right moment.
- Postgame share card: the grade card paragraph is the perfect iMessage text. Wire ShareButton to use it on finals.
- Remember collapsed/open per section in localStorage so a reader who always skips Conditions never sees it open.
- Live scorecard could grade the side and total continuously on the Record page as "would have covered at halftime" to see whether the model's edges show early.
