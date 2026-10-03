# Agent report: ai-layer

## What I built

An AI layer that explains and ranks the evidence the app already computes. It cannot add a player, a stat, a scheme, or a line, and the code checks that claim rather than trusting the prompt.

1. **Provider adapter** `src/lib/llm.ts`. `llmInfo()`, `generateJSON(prompt, schema)`, and `runTools(question, tools)`. Anthropic (`claude-opus-5`, structured output via `output_config.format`, effort medium) when `ANTHROPIC_API_KEY` is set; OpenAI (`gpt-5.4` for reports, `gpt-5.4-mini` for Ask, Responses API for the tool loop, reasoning low) when `OPENAI_API_KEY` is set; otherwise `{ unavailable: "add ANTHROPIC_API_KEY" }`. Keys load from `.env.local`, then `~/scripts/.env`, never logged. Every call appends tokens, cache reads, estimated cost, and latency to `data/ai/usage.jsonl`. Current Claude models do not accept `temperature` (400), so effort is the control; OpenAI reports run at reasoning low.
2. **Written report** `src/lib/report.ts`. `buildPacket(game)` turns a Game into 100 to 200 facts, each with an id (G, W, P, M, J, C, R, E, S, X, K, T, Z, B, V, N prefixes). `generateReport()` asks for `{headline, openingParagraph, sections[{title, paragraphs, factIds}], oneLineForCard}` and `validateReport()` rejects: any number not in the packet (sign dropped, rounding to the output's decimals allowed, percent and fraction forms allowed, integers 0 to 3 allowed as plain English), any capitalized token not in the packet vocabulary (possessives stripped), unknown fact ids, emojis, em dashes, body outside 240 to 460 words, and any mention of "the packet" or "the data". One retry with the violations listed and the prior attempt attached; a second failure writes a record with `failed.reasons` and nothing is shown. Cache: `data/ai/reports/<season>/<gameId>.json` with `evidenceAsOf` (game.reportAsOf), `pregame`, `attemptLog`, usage, and cost.
3. **UI** `src/components/WrittenReport.tsx` (server, reads the cache, never calls a model on load) + `src/components/WriteReportButton.tsx` (client, posts to `/api/report`, then refreshes). Sits right after Why watch with `id="report"`; "Report" is in the jump bar. Shows the model, the time, the evidence time, and "every name and number checked against the evidence packet (N facts)". A pregame report on a game that has since kicked off gets a "Rewrite with the final" button. Missing key: one line saying what to add. Non Division I: one line, no button.
4. **Ask the slate** `/ask` (`src/app/ask/page.tsx`, `src/components/AskSlate.tsx`, `src/lib/ask.ts`, `src/app/api/ask/route.ts`). Tools: `getSlate` (day, optional division; each game carries its single biggest unit matchup with the percentile gap), `getGame` (the same evidence packet the report uses), `radarBoard`, `forecastBoard`, `getRecord` (archive entries plus `historyStats`), and `finish` (answer, gameIds, playerIds, notInData). Ids resolve to link chips for games and players; the tool calls, model, and cost show under every answer. Em dashes in answers are replaced. Linked from the slate header ("Ask the slate"); NAV was left alone because the mobile tab bar is a fixed six-column grid.
5. **Batch script** `scripts/write-reports.mjs`. Lists today's locked Division I games from `data/archive`, posts each to `/api/report` sequentially with a pause. Flags: `--dry`, `--date`, `--ids`, `--limit`, `--force`, `BASE` env. README has the budget note.
6. **Audit endpoint** `GET /api/report?id=<gameId>` returns the packet and the cached record, so any sentence in a report can be traced to a fact id.

## Files touched

New: `src/lib/llm.ts`, `src/lib/report.ts`, `src/lib/ask.ts`, `src/app/api/report/route.ts`, `src/app/api/ask/route.ts`, `src/app/ask/page.tsx`, `src/components/WrittenReport.tsx`, `src/components/WriteReportButton.tsx`, `src/components/AskSlate.tsx`, `scripts/write-reports.mjs`, `scripts/test-report-validation.ts`, `data/ai/` (usage log, one cached report).
Edited (additive): `src/app/game/[id]/page.tsx` (import, jump bar entry, one component call), `src/app/page.tsx` (one link), `README.md` (AI layer section), `package.json` (`@anthropic-ai/sdk` 0.131.0, `openai` 7.27.0).

## What was tested

- `npx tsc --noEmit` clean; eslint clean on the new files.
- Offline validator (`npx tsx scripts/test-report-validation.ts`): a packet-faithful fake report is accepted; the same report with "Cade Klubnik threw for 312 yards" and "Antonio Williams had 7 catches" added is rejected naming Cade, Klubnik, Antonio, Williams, 312, and 34. PASS.
- Live, OpenAI fallback, on a temporary `next dev -p 3077` (PM2 was not touched; it runs `next start` so the new routes appear only after the orchestrator rebuilds):
  - Report for 401858249 (Miami at Clemson, 179 facts). First run: both attempts rejected for length (587 and 586 words), correctly not published. After tightening the prompt: published, 459 body words, 1 attempt, $0.033. Spot audit against the packet: "No. 3 of 138 line yards 3.89", "Clemson No. 135 at 3.46", "market moved from -12 to -15.5", Mensah's 1211 yds 14 TD 0 INT 11.4 Y/A all match fact ids M1, M1e, K1, R6s.
  - Ask "biggest line-of-scrimmage mismatch tonight": first answered by point spread (LSU -53) from the slate list alone. After adding the top matchup to each slate row and a prompt rule that a spread is not a matchup: "Miami at Clemson, dominant edge, 97 percentile-point gap, top radar name Sammy Brown", with game and player chips. $0.015.
  - Ask trap "Clemson's starting QB and his career picks against Miami": with chat completions and reasoning off, gpt-5.4-mini mislabeled Miami's Darian Mensah. After moving to the Responses API with reasoning on and a no-depth-chart rule: "not in the data", lists the Clemson radar names it did find, notInData true. $0.022.

## Cost per report

Measured on gpt-5.4: about 7,000 input and 1,300 output tokens per attempt, $0.033 for a one-attempt report, $0.057 to $0.064 when the retry fires (the retry gets a 5,900-token cache hit). Claude Opus 5 at $5/$25 per million lands in the same range, about $0.07 per attempt. Ask: $0.013 to $0.022 per question on gpt-5.4-mini. A 42-game Saturday of reports is roughly $1.50 to $2.50.

## Keys needed

`ANTHROPIC_API_KEY` in `.env.local` switches everything to Claude with no code change. Until then the OpenAI key in `~/scripts/.env` is picked up automatically. The server reads the file once per process, so adding a key means a restart.

## Known gaps

- The number check cannot catch a correct number attached to the wrong fact (the packet has "No. 3" and "No. 20"; a sentence swapping them passes). The proper-noun check cannot catch a lowercase invention. The fact-id citations are the model's own and are only checked for existence.
- Body length lands at 459 on the one live run; the validator allows 240 to 460 against a 250 to 450 spec, so the model is using the slack.
- The Anthropic path is written to the current SDK types but has not run end to end (no key on the machine). Refusal fallbacks (`fallbacks: "default"` on the beta path) were left out on purpose: sports evidence does not trip safety classifiers, and it would add beta types I could not test.
- Consensus and situations are read defensively (`game.consensus`, `game.situations` if present as fact C1 / Z). If those agents use other field names, the packet needs a one-line update.
- No per-user rate limit on `/api/ask` or `/api/report`. On a public box, add one.

## Ideas

- **Card line**: `oneLineForCard` is already in the cache; show it on `GameCard` for games with a report and let the slate page carry 10 written one-liners for a dollar.
- **Postgame rewrite on grade**: when `gradePostgame` fires, rewrite the report with the V facts so the written piece says what played out; the `stale` flag already detects this.
- **Fact-level highlighting**: since every section carries fact ids, the UI could show the underlying facts on hover, which turns the "checked against the packet" line into something the reader can click.
- **Eval set from rejections**: `attemptLog` already stores every violation. After a few weeks that is a free eval set for prompt tuning (`/claude-api build-eval`).
- **Telegram one-liners**: the telegram agent's daily send could include the card line for the top three reported games.
- **Ask memory of the week**: let `getSlate` take a week, and give Ask a `compareGames(idA, idB)` tool that diffs two packets, which is the question people ask most on a Saturday morning.
