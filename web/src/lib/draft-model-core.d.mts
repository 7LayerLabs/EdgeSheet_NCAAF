/** Types for draft-model-core.mjs (shared by the app and scripts/draft-fit.mjs). */
import type { GenPlayer } from "./generated";

export const GROUP: Record<string, string>;
export const GROUPS: string[];
export const POWER: Set<string>;
export const PRIOR_GAMES: number;
export type SizeTable = Record<string, { hMean: number; hSd: number; wMean: number; wSd: number }>;
export function groupOf(pos: string | null | undefined): string | null;
export function valueOfPick(overall: number | null | undefined): number;
export function pickOfValue(v: number): number;
export function production(p: GenPlayer, group: string): number;
export function productionPercentiles(players: GenPlayer[]): Map<string, number>;
export function blendProduction(cur: number | null | undefined, prior: number | null | undefined, games: number | null | undefined): number;
export function features(p: GenPlayer, group: string, prod: number, size: SizeTable, teamElo?: number | null): Record<string, number>;
export function predict(weights: Record<string, number>, f: Record<string, number>): number;
