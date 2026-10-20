/** Dark War Survival — Rally formation matchmaking typings */

import type { CategorizedMember, DominantFaction } from "./rallyRoles";

export interface RallyGroup {
  leader_name: string;
  leader_faction: DominantFaction;
  max_capacity: number;
  recommended_joiners: string[];
  /** Joiners assigned only after same-faction pool was exhausted. */
  off_faction_fillers: string[];
  expected_total_troops: number;
  is_faction_pure: boolean;
  /** Unfilled marches after packing against max_capacity. */
  open_slots: number;
}

export interface SuggestRallyOptions {
  /** Average troops each RJ sends per march. Default: 100_000 */
  joinerMarchTroops?: number;
  /** If true (default), each RJ is assigned to at most one RL. */
  exclusiveJoiners?: boolean;
}

export const DEFAULT_JOINER_MARCH_TROOPS: number;

export function slotsForCapacity(capacity: number, marchTroops: number): number;

/**
 * For each Rally Leader, pack compatible Rally Joiners into a suggested strike team.
 * Priority: same faction → capacity packing (floor(capacity / march)) → off-faction fillers.
 */
export function suggestRallyFormations(
  categorized: CategorizedMember[],
  options?: SuggestRallyOptions
): RallyGroup[];
