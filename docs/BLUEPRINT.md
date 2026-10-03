# College Game Scout Product Blueprint


College Game Scout Product Blueprint
Working plan for a college football game discovery and NFL prospect companion
Prepared for Derek | September 2026
Core promise: Select any college football game and know why it is worth watching, who matters, how the teams play, and what conditions could change the matchup.
The product should cover marquee games and late-night small-school games through the same interface. It should never invent a prospect or pretend that every game has equal data. Each report will show its data freshness and coverage confidence.
Executive Decision
Build a mobile-first web app that lists the complete daily slate, lets the user open any matchup, and produces a pregame report assembled from verified schedules, rosters, statistics, scouting records, weather, and market data. The AI explains those records; it does not create the underlying facts.
The broad product target is FBS, FCS, Division II, Division III, and NAIA. The launch sequence should begin with complete Division I coverage and a clearly labeled lower-division beta. This protects the promise of every game while acknowledging that lower-division live data is less consistent.
Product decision
Recommendation
Reason
Primary user
Fans who watch college football through an NFL scouting lens
This matches the original use case and keeps the product focused
Main action
Scout this game
One obvious action creates a complete report
Platforms
Responsive web app first, native apps later
Fastest path to phones, tablets, and desktops
Coverage
All scheduled games with confidence tiers
A thin honest report is better than excluding an obscure game
Odds role
Game context, line movement, and market expectation
Useful even for users who are not placing bets
AI role
Explain, compare, summarize, and personalize
Verified databases remain the source of truth

Product Experience
Daily Slate
The home screen opens to Today and shows every scheduled game in kickoff order. Users can switch days or weeks and filter the slate without losing obscure games.
All Games, Live, Upcoming, Finished, Top Prospects, Hidden Gems, and Watchlist filters
Division filters for FBS, FCS, Division II, Division III, and NAIA
Conference, kickoff time, network or stream, prospect count, draft year, weather risk, and spread filters
Late Night Radar for games still active or starting after 9 p.m.
A Why Watch line on every game card
Game card element
Example
Purpose
Scout Score
84 Hidden Gem
Ranks viewing value, not team quality
Prospect count
2 likely picks, 4 future names
Sets scouting expectations
Style label
Fast spread offense vs pressure-heavy defense
Explains the matchup quickly
Conditions
18 mph crosswind, 70 percent rain
Flags weather that can change play calling
Market
Home -4.5, total 51.5
Shows the market expectation
Coverage
Full, Standard, or Limited
Makes data quality visible

Game Report
Every game page uses the same structure so a user can scan it in under a minute or study it during the broadcast.
1. Game header with teams, records, kickoff, venue, broadcast, spread, total, and live status
2. Why Watch summary with the best three reasons to turn on the game
3. Team Style matchup showing how each offense and defense wants to play
4. Weather Impact showing conditions at kickoff and the likely football effect
5. Must Watch Prospects grouped by expected draft year and projected range
6. Prospect Matchups identifying the opposing players who will test each other
7. Keep an Eye On for sleepers, risers, young players, and former top recruits
8. Storylines covering transfers, injuries, coaching ties, rivalry context, and milestone pursuits
9. Live Notes during the game and a postgame Draft Stock review after the final whistle
Weather Intelligence
Weather becomes analysis only when it is tied to stadium conditions and team behavior. A raw temperature icon is not enough.
Weather input
Display
Football interpretation
Wind
Speed, gusts, direction, crosswind
Deep passing, field goals, punts, and sideline choice
Precipitation
Chance, intensity, timing
Ball security, footing, pass volume, and tempo
Temperature
Actual and feels-like
Fatigue, cramping, cold-ball handling, and rotation depth
Humidity
Percent and heat index
Conditioning and defensive substitution risk
Storm risk
Alert level and expected window
Delay risk and changing kickoff conditions
Field and roof
Grass or turf, open or closed roof
Determines whether local weather matters
Altitude
Venue elevation
Adds context for conditioning and kicking distance

Weather Rules Engine
The app should calculate rule-based flags before AI writes the explanation. The model can phrase the result but cannot decide that conditions are severe without a threshold.
Wind warning: flag sustained wind at 15 mph and elevate at 20 mph or stronger gusts.
Rain warning: flag meaningful precipitation during the game window, not only the daily forecast.
Heat warning: combine temperature and humidity; emphasize depth and tempo when the heat index is high.
Cold warning: flag freezing or near-freezing conditions and explain kicking and ball-handling effects cautiously.
Indoor override: suppress outdoor weather effects when a fixed roof is confirmed; treat retractable roofs as unknown until status is available.
Team Styles and Schemes
Each team receives an offense card, a defense card, and season-to-date tendency metrics. The report compares those identities and names the likely pressure point.
Offensive Profile
Category
Metrics and labels
Run and pass balance
Overall pass rate, neutral-situation pass rate, early-down pass rate, designed QB run rate
Tempo
Seconds per play, no-huddle rate, plays per game, situation-adjusted pace
Structure
Spread, pro-style, air raid influence, option, RPO-heavy, multiple
Personnel
11, 12, 20, and 21 personnel usage where charting supports it
Run game
Inside zone, outside zone, power, counter, duo, option, and gap-zone balance
Pass game
Play-action, screen rate, quick game, deep-shot rate, motion, empty formations
Efficiency
Success rate, explosive rate, EPA per play, third-down conversion, red-zone touchdown rate
Protection
Pressure allowed, sack rate, time to throw, and performance against blitzes

Defensive Profile
Category
Metrics and labels
Front
Even, odd, multiple, light-box frequency, and defensive line movement
Coverage
Man and zone estimates, single-high and two-high families, quarters influence
Pressure
Blitz rate, simulated pressure, pressure rate, sack conversion, third-down pressure
Run defense
Box count, stuff rate, yards before contact, missed tackles, edge-setting performance
Pass defense
Explosives allowed, completion rate over expectation where available, yards after catch
Situations
Early downs, third down, red zone, two-minute defense, and late-game behavior

Matchup Language
The report should make specific comparisons: a pass-heavy offense facing a defense that plays man coverage and blitzes frequently; a gap-run team facing a light box; or a slow offense trying to keep a high-tempo opponent off the field. Each conclusion should cite the inputs used and label small samples.
Spreads Totals and Market Context
The initial product should show the market without positioning itself as a picks service. Odds help explain expectations: who is favored, whether the market expects a shootout, and whether opinion changed during the week.
Market field
Display rule
Consensus spread
Median or consensus across selected books with timestamp
Opening and current line
Show movement and the time window
Total
Use as game-environment context beside pace and weather
Moneyline
Optional secondary information
Book detail
Expandable list of books and last update time
Missing odds
Say No widely available line instead of estimating one

Market Explanations
A low total paired with two slow, run-heavy teams suggests limited possessions.
A falling total alongside worsening wind should be labeled as correlation, not proof that weather caused the move.
A large spread can shift prospect viewing toward individual matchups and younger players expected to get late snaps.
Line movement must always include an as-of time because college markets can change quickly.
If the product later adds affiliate sportsbook links or personalized betting recommendations, it will need state-aware legal review, age controls, responsible-gambling language, and vendor terms that permit the intended display and use.
Prospect System
The prospect database is the product's editorial backbone. It must distinguish draft eligibility from likely declaration year and from projected draft range.
Prospect tier
Meaning
Report depth
Established
Recognized draft prospect with multiple credible evaluations
Full profile, range, traits, matchup, evidence
Emerging
Production or traits suggest a possible draft path
Short profile with a lower confidence label
Future
Not eligible for the next draft but worth tracking
Eligibility year, development points, current role
Sleeper
Late-round or undrafted range with a clear NFL trait
Trait, obstacle, and specific game test
Watch only
Interesting college player without a current NFL projection
Explain why the player matters without forcing a draft label

Required Player Fields
Canonical player ID, name, team, jersey number, position, class, height, weight, hometown, and transfer history
High-school graduation year, seasons played, redshirt status, eligibility notes, expected NFL draft year, and eligibility confidence
Season and career statistics, snaps where available, injuries, depth-chart role, and recent trend
Consensus ranking, position ranking, projected round, source count, last update time, and projection confidence
Traits, weaknesses, role projection, matchup assignment, and exact watch points
Draft Projection Rules
Never present one mock draft as a consensus.
Store each board separately, normalize rankings, and retain source and publication date.
Show a range when evaluators disagree and reduce confidence when source count is low.
Recheck roster, injury, and eligibility data before each game report is published.
Do not move stock from one game automatically. Postgame changes need evidence and editorial approval in early versions.
Game Scoring and Discovery
Scout Score ranks how interesting a game is for this product. It should not simply reproduce rankings or betting popularity.
Component
Initial weight
Examples
Draft talent
35 percent
Round 1 prospects, total likely picks, prospect depth
Direct matchups
20 percent
NFL-caliber tackle against edge, receiver against corner
Future talent
15 percent
Young quarterbacks, breakout sophomores, former elite recruits
Competitive expectation
10 percent
Spread, team strength, rivalry context
Style contrast
10 percent
Tempo clash, run-heavy offense against elite front
Storylines
5 percent
Transfer return, coaching connection, injury return
Availability
5 percent
Live or upcoming, accessible broadcast or stream

Weather does not add points simply because it is bad. It adjusts the matchup interest and adds a Conditions badge when it can materially change how the game is played.
Coverage for Every Game
Every scheduled game gets a page, but reports carry one of three coverage labels. This is essential for lower divisions.
Coverage level
Expected data
User experience
Full
Verified roster, live play-by-play, detailed stats, weather, odds when available, prospect records
Pregame, live, and postgame report
Standard
Schedule, roster, box score, team tendencies, weather, partial prospect research
Strong pregame report and postgame recap
Limited
Verified schedule and basic roster or team data; little or no live feed
Short report with explicit gaps and future players to monitor

Recommended Launch Coverage
Phase
Coverage promise
Reason
Private prototype
Selected FBS and FCS games
Validate report usefulness and data matching
Public MVP
All Division I games
Commercial feeds can support a reliable complete slate
Lower-division beta
DII, DIII, and NAIA schedule coverage with Standard or Limited labels
Proves discovery demand before expensive data operations
Full expansion
Deep lower-division rosters, stats, and scouting
Requires provider agreements and a dedicated data-quality workflow

Data Strategy
Provider Recommendation
Use a replaceable provider layer so the app is not locked to one vendor. The database should store internal IDs and a crosswalk to every vendor's IDs.
Need
Prototype option
Production option
Important limitation
Schedules, teams, stats
CollegeFootballData and approved public sources
Sportradar or another licensed commercial feed
Coverage depth differs by division
FBS real time
CollegeFootballData or trial feed
Sportradar or SportsDataIO
Licensing and redistribution terms control display
FCS
CollegeFootballData plus school verification
Sportradar Division I coverage
Full live play-by-play is not universal
DII, DIII, NAIA
Schedule aggregation and editorial verification
Specialized partner or direct institutional feeds
No single assumed source should be treated as complete
Odds
The Odds API
Licensed odds vendor with desired books and latency
Many obscure games have no market
Weather
National Weather Service for US venues
NWS plus commercial fallback
Stadium coordinates and roof status must be correct
Draft boards
Curated editorial database
Licensed scouting feeds plus internal consensus
Do not scrape paywalled boards without permission
News and injuries
Approved feeds and team releases
Licensed news feed and editorial review
College injury reporting is inconsistent

Current Vendor Evidence
Sportradar states that its NCAA Football API covers all Division I games, with real-time play-by-play for FBS games and end-of-night player and team data for its extended FCS coverage. SportsDataIO advertises real-time coverage for every FBS game. The Odds API supplies college football spreads, totals, moneylines, and historical odds on paid plans. These claims support Division I as the first reliable public coverage milestone; they do not prove full DII, DIII, or NAIA coverage.
Ingestion Schedule
Job
Timing
Season schedule import
Preseason, then daily reconciliation
Roster and depth chart sync
Daily; every two hours on game day
Odds snapshots
At open, daily, then every 5 to 15 minutes near kickoff based on plan limits
Weather forecasts
Daily at long range; hourly inside 24 hours; every 15 minutes near kickoff if needed
News and status
Continuous or every 15 minutes on game day
Pregame report
Initial version 48 hours before kickoff; refresh at 24 hours, 6 hours, and 60 minutes
Postgame report
Generate after final stats settle, then re-run quality checks

AI and Editorial Pipeline
The app should create reports from a structured game packet. The model receives verified records, calculated tendencies, current conditions, and source timestamps. It returns a typed report that the application validates before publishing.
1. Resolve the game and both teams to internal canonical IDs
2. Load schedules, roster status, depth charts, injuries, player profiles, and season statistics
3. Calculate team tendencies, scheme labels, matchup edges, Scout Score, and coverage confidence
4. Load stadium conditions, hourly weather, odds snapshots, and line movement
5. Retrieve current scouting sources and historical notes for relevant players
6. Build a structured evidence packet with a source and timestamp for every factual field
7. Generate the report as validated JSON rather than free-form text
8. Run factual checks for team, jersey, eligibility, injury, and projection conflicts
9. Publish the report and log the evidence version that produced it
Automated Guardrails
Reject any player who is not on the current roster or verified game roster.
Reject draft-year claims that conflict with stored eligibility rules unless an editor overrides them.
Require an as-of time for weather, odds, injury, and depth-chart claims.
Downgrade language from projected pick to player to watch when draft evidence is weak.
Do not infer a defensive coverage family from generic season totals alone.
Label scheme metrics as unavailable when play-by-play or charting does not support them.
Screens
Screen
Main content
Primary action
Today
Full slate, filters, Scout Score, conditions, prospect counts
Open game
Game Overview
Why Watch, style matchup, weather, spread, top names
Scout this game
Prospects
Draft-year groups, projections, traits, confidence
Follow player
Matchups
Head-to-head prospect tests and scheme stress points
Open matchup detail
Live
Score, key plays, prospect notes, updated conditions
Add observation
Postgame
Performance summary and evidence-based stock notes
Save or share
Player
Bio, eligibility, projection history, schedule, watch points
Add to watchlist
Watchlist
Upcoming games and alerts for followed players
Set notifications
Admin
Identity conflicts, data gaps, report queue, overrides, costs
Review and publish

Database Design
Domain
Core tables
Identity
schools, teams, conferences, venues, provider_ids
Schedule
seasons, games, broadcasts, game_status_history
Players
players, roster_memberships, player_seasons, injuries, depth_chart_entries
Performance
team_game_stats, player_game_stats, plays, drives, calculated_metrics
Scouting
prospect_profiles, draft_eligibility, source_rankings, consensus_snapshots, traits, evaluations
Context
weather_snapshots, odds_snapshots, storylines, team_scheme_profiles
Reports
game_reports, report_sections, evidence_items, report_versions, quality_flags
Users
users, follows, saved_games, alert_preferences, observations
Operations
ingestion_runs, provider_errors, identity_conflicts, editorial_overrides, usage_costs

Critical Modeling Rules
A player is separate from a roster membership so transfers do not create duplicate people.
Draft eligibility is versioned because class labels and redshirt records are often wrong.
Odds and weather are snapshots, never single mutable fields.
Reports point to the exact evidence version used for publication.
Team style is season-specific and can change after coordinator or quarterback changes.
Technical Architecture
Layer
Recommendation
Web application
Next.js with TypeScript and responsive React components
Database and auth
Postgres with Supabase Auth, row-level security, and object storage
Data processing
Scheduled workers for imports, normalization, metrics, and report generation
Queue
Durable job queue for game refreshes and retries
AI
Structured-output model calls with retrieval, evidence IDs, and deterministic validation
Search
Postgres search first; dedicated search service only when usage requires it
Cache
Edge and server cache for slate and report pages; invalidate on source updates
Hosting
Vercel for the web layer; managed Postgres and worker runtime
Observability
Errors, provider freshness, job lag, model cost, report failures, and user events

Notifications and Retention
Your Watchlist Plays Today with kickoff times and broadcast information
Hidden Gem Alert when a high Scout Score game is about to start
Weather Changed when conditions materially alter the game plan
Line Moved when the spread or total crosses a user-selected threshold
Prospect Matchup Starting Soon for followed players
Postgame Stock Note after the report is ready
Push alerts should be opt-in by category. The first web version can use email and browser notifications; native mobile push can follow once retention is proven.
MVP Scope
Build Now
Complete Division I slate and game search
Pregame report with prospects, future prospects, storylines, team styles, weather, spread, total, and Why Watch
Scout Score and coverage confidence
Player and game watchlists
Admin review for identity conflicts and report quality
Responsive design suitable for phone use during games
Delay Until After Validation
Live play-by-play commentary for every game
Native iOS and Android applications
Public user predictions, social feeds, and chat rooms
Personalized betting picks or bet tracking
Automated draft-stock movement without review
Full manual scouting reports on every lower-division roster
Twelve Week Build Plan
Weeks
Deliverable
Exit test
1 to 2
Product spec, source audit, internal IDs, clickable wireframes
Ten sample games map cleanly across sources
3 to 4
Schedule, team, player, venue, weather, and odds ingestion
Daily slate is accurate and updates automatically
5 to 6
Prospect database, draft eligibility, consensus logic
No roster or draft-year errors in test set
7 to 8
Team tendency metrics, scheme labels, Scout Score
Reports explain pass-run balance and matchup with evidence
9
AI report generation and factual validation
Structured reports pass automated checks
10
Watchlists, alerts, sharing, and admin review
End-to-end user flow works on mobile
11
Private beta across a full Division I Saturday
Every game has a page; failures are visible and recoverable
12
Performance, cost controls, accessibility, and launch fixes
Slate and game pages meet speed and reliability targets

Cost Plan
Sports data is the largest unknown cost. Commercial pricing is often quote-based and depends on coverage, latency, redistribution rights, traffic, and whether odds or images are included. The following figures are planning ranges, not vendor quotes.
Stage
Likely monthly operating range
Main cost drivers
Prototype
$200 to $1,500
Developer data plans, weather, odds, AI, database, hosting
Private beta
$1,000 to $6,000
Higher API limits, full-Saturday processing, monitoring, email
Licensed public product
$5,000 to $25,000 plus
Commercial sports rights, traffic, real-time feeds, support

Before signing a sports-data contract, request a coverage matrix for FBS, FCS, DII, DIII, and NAIA; explicit rights for public display; historical storage terms; rate limits; live latency; player images; odds rights; and termination or migration terms.
Business Model
Tier
Suggested offer
Free
Daily slate, short Why Watch summaries, limited game reports, basic watchlist
Scout Plus
$7.99 to $11.99 monthly for full reports, all filters, alerts, and prospect history
Season Pass
$39 to $59 for the college season to match football viewing behavior
Draft Plus
Offseason prospect tracking, board changes, combine and pro-day updates
Media or creator
Embeddable game cards, research exports, and branded reports

The product should prove that users repeatedly open game reports before optimizing price. Track free-to-report conversion, reports viewed per Saturday, watchlist follows, alert opens, and four-week retention.
Risks and Controls
Risk
Control
Wrong roster or transfer
Canonical IDs, daily sync, and pre-publication game-roster check
Wrong draft eligibility
Stored high-school year, participation history, confidence flag, editorial override
Hallucinated scheme
Require charting or calculated evidence; otherwise say unavailable
Thin lower-division data
Coverage badges and shorter reports without invented projections
Vendor lock-in
Provider adapter layer and internal ID crosswalk
Odds compliance
Informational presentation first, state-aware review before affiliate or picks features
High Saturday traffic
Pre-generate reports, cache slate pages, prioritize update queues
AI cost spikes
Template stable sections, cache evidence packets, regenerate only changed sections

Working Name Options
College Game Scout is only a planning label. Each option should be checked for trademark and domain availability before selection.
Name
What it communicates
Scout the Slate
Every game on the day's schedule can be explored
Saturday Scout
Simple college football viewing companion
Gridiron Radar
Discovers prospects and hidden games
SnapScout
Fast, mobile, and player-focused
Next Level Watch
Connects college players to future NFL potential
GameTape Guide
Helps viewers know what to study during a game
Prospect Saturday
Direct draft and scouting focus

Example Report Structure
Michigan vs Oklahoma
This is a layout demonstration. Live names, projections, statistics, weather, and odds would be populated from the current evidence packet at report time.
Report block
Example output
Why Watch
A future NFL quarterback faces a pressure-oriented defense; the interior line matchup includes draftable talent; contrasting offensive tempo could determine possession count.
Conditions
Kickoff forecast, roof status, wind direction, precipitation window, and a plain-language effect on passing and kicking.
Market
Opening spread, current consensus spread, total, movement, and timestamp.
Team styles
Michigan run-pass balance, pace, core run concepts, protection profile; Oklahoma pressure rate, front, and coverage tendencies.
Must Watch
Verified prospects with jersey number, draft year, projected range, and two specific traits to watch.
Matchup
A named blocker and defender who will meet directly, plus the evidence that makes the test important.
Future
Underclassmen who are not yet draft eligible, with the correct earliest eligible year.
Live and postgame
Observed performance tied to plays and statistics, followed by cautious stock notes.

Immediate Next Decisions
1. Choose the product's audience wording: serious fans, draft fans, or both.
2. Choose a temporary name so the wireframes and repository have a stable label.
3. Approve Division I as the reliable public MVP while lower divisions enter through labeled beta coverage.
4. Decide whether spreads remain informational at launch or whether betting-oriented features are part of the business model.
5. Select ten test games across FBS, FCS, DII, DIII, and NAIA to expose data gaps before engineering begins.
6. Build the first clickable screens and one real report generated from live structured data.
Source Notes
Source pages were reviewed on September 12, 2026. Vendor coverage and pricing can change, so contracts and current documentation must be checked before implementation.
Sportradar NCAA Football API overview
SportsDataIO College Football API
The Odds API
National Weather Service API
CollegeFootballData
