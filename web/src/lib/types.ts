export type Division = "FBS" | "FCS" | "DII" | "DIII" | "NAIA";
export type Coverage = "Full" | "Standard" | "Limited";
export type GameStatus = "upcoming" | "live" | "final";
export type ProspectTier = "Established" | "Emerging" | "Future" | "Sleeper" | "Watch only";

export interface Team {
  id: string;
  name: string;
  short: string;
  abbr: string;
  record: string;
  conference: string;
  color: string;
  logo?: string;
}

export interface WeatherInput {
  windMph: number;
  gustMph: number;
  windDir: string;
  crosswind: boolean;
  precipChance: number;
  precipWindow?: string;
  tempF: number;
  feelsLikeF: number;
  humidity: number;
  stormRisk: "none" | "watch" | "warning";
  roof: "open" | "fixed" | "retractable-unknown" | "retractable-closed";
  surface: "grass" | "turf";
  elevationFt: number;
  asOf: string;
}

export interface Market {
  spread?: { team: string; line: number; open: number };
  total?: { line: number; open: number };
  moneyline?: { home: number; away: number };
  books?: number;
  asOf: string;
}

export interface Prospect {
  id: string;
  name: string;
  team: string;
  jersey: number;
  pos: string;
  cls: string;
  ht: string;
  wt: number;
  draftYear: number;
  eligibilityConfidence: "High" | "Medium" | "Low";
  tier: ProspectTier;
  projected: string;
  sourceCount: number;
  projectionConfidence: "High" | "Medium" | "Low";
  traits: string[];
  weakness?: string;
  watchFor: string;
  stat?: string;
}

export interface Matchup {
  a: string;
  b: string;
  why: string;
  evidence: string;
}

export interface OffenseProfile {
  label: string;
  passRate: number;
  neutralPassRate: number;
  secondsPerPlay: number;
  structure: string;
  runGame: string;
  passGame: string;
  successRate: number;
  explosiveRate: number;
  pressureAllowed: number;
  sample: "full" | "small" | "unavailable";
}

export interface DefenseProfile {
  label: string;
  front: string;
  coverage: string;
  blitzRate: number;
  pressureRate: number;
  stuffRate: number;
  explosivesAllowed: number;
  sample: "full" | "small" | "unavailable";
}

/** Each component is 0 to 100. null means the input is not available yet;
 *  the score renormalizes over the components it can actually see. */
export interface ScoreComponents {
  draftTalent: number | null;
  directMatchups: number | null;
  futureTalent: number | null;
  competitive: number | null;
  styleContrast: number | null;
  storylines: number | null;
  availability: number | null;
}

export interface Game {
  id: string;
  division: Division;
  home: Team;
  away: Team;
  kickoff: string;
  venue: string;
  city: string;
  network: string;
  status: GameStatus;
  score?: { home: number; away: number; clock: string };
  coverage: Coverage;
  whyWatch: string;
  whyWatchReasons: string[];
  styleLine?: string;
  weather?: WeatherInput;
  market: Market;
  prospects: Prospect[];
  matchups: Matchup[];
  keepAnEyeOn: { name: string; team: string; note: string }[];
  storylines: string[];
  offense: Record<string, OffenseProfile>;
  defense: Record<string, DefenseProfile>;
  pressurePoint: string;
  scoreComponents: ScoreComponents;
  gaps?: string[];
  reportAsOf: string;
  /** "live" = CollegeFootballData, "sample" = hand-written prototype data */
  source: "live" | "sample";
  week?: number;
}
