/** Dark War Survival — Rally role classifier typings */

export type DominantFaction = "Fighter" | "Shooter" | "Rider";
export type RallyRole = "RL" | "RJ";

export interface MemberInput {
  id: string;
  name: string;
  /** Highest APC march CP across APC1–APC4 (empty/0 skipped by callers). */
  max_apc_cp: number;
  rally_capacity: number;
  /** Faction of the classifying (highest) march. */
  apc1_faction: DominantFaction;
}

export interface CategorizedMember extends MemberInput {
  assigned_role: RallyRole;
  specialty_faction: DominantFaction;
}

/** Median of each member's highest APC march CP from live uploaded roster. */
export interface RallyThresholds {
  minApcCp: number;
}

export interface RallyRoleSummary {
  total: number;
  rl: number;
  rj: number;
  byFaction: Record<DominantFaction, number>;
}

export const DEFAULT_THRESHOLDS: RallyThresholds;

export function normalizeThresholds(
  thresholds?: Partial<RallyThresholds> | { minApc1Cp?: number } | null
): RallyThresholds;

export function meetsRallyLeaderThresholds(
  member: Pick<MemberInput, "max_apc_cp" | "rally_capacity"> | { apc1_cp?: number; max_apc_cp?: number; rally_capacity?: number },
  thresholds?: Partial<RallyThresholds> | { minApc1Cp?: number }
): boolean;

export function classifyMember(
  member: MemberInput | (Omit<MemberInput, "max_apc_cp"> & { apc1_cp?: number; max_apc_cp?: number }),
  thresholds?: Partial<RallyThresholds> | { minApc1Cp?: number }
): CategorizedMember;

export function classifyAllianceMembers(
  members: MemberInput[],
  thresholds?: Partial<RallyThresholds> | { minApc1Cp?: number }
): CategorizedMember[];

export function summarizeRallyRoles(
  categorized: CategorizedMember[]
): RallyRoleSummary;

export function deriveThresholdsFromRoster(
  samples: Array<{ max_apc_cp?: number; apc1_cp?: number; rally_capacity?: number }>
): RallyThresholds & { sampleApc: number };

export function median(values: number[]): number;

export function memberMaxApcCp(
  member: { max_apc_cp?: number; apc1_cp?: number }
): number;

export const DEFAULT_JOINER_MARCH_TROOPS: number;

export function slotsForCapacity(capacity: number, marchTroops: number): number;

export interface RallyGroup {
  leader_name: string;
  leader_faction: DominantFaction;
  max_capacity: number;
  recommended_joiners: string[];
  off_faction_fillers: string[];
  expected_total_troops: number;
  is_faction_pure: boolean;
  open_slots: number;
}

export interface SuggestRallyOptions {
  joinerMarchTroops?: number;
  exclusiveJoiners?: boolean;
}

export function suggestRallyFormations(
  categorized: CategorizedMember[],
  options?: SuggestRallyOptions
): RallyGroup[];
