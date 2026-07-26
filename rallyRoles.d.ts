/** Dark War Survival — Rally role classifier typings */

export type DominantFaction = "Fighter" | "Shooter" | "Rider";
export type RallyRole = "RL" | "RJ";

export interface MemberInput {
  id: string;
  name: string;
  apc1_cp: number;
  rally_capacity: number;
  apc1_faction: DominantFaction;
}

export interface CategorizedMember extends MemberInput {
  assigned_role: RallyRole;
  specialty_faction: DominantFaction;
}

/** APC1 median gate from live uploaded roster. */
export interface RallyThresholds {
  minApc1Cp: number;
}

export interface RallyRoleSummary {
  total: number;
  rl: number;
  rj: number;
  byFaction: Record<DominantFaction, number>;
}

export const DEFAULT_THRESHOLDS: RallyThresholds;

export function normalizeThresholds(
  thresholds?: Partial<RallyThresholds> | null
): RallyThresholds;

export function meetsRallyLeaderThresholds(
  member: Pick<MemberInput, "apc1_cp" | "rally_capacity">,
  thresholds?: Partial<RallyThresholds>
): boolean;

export function classifyMember(
  member: MemberInput,
  thresholds?: Partial<RallyThresholds>
): CategorizedMember;

export function classifyAllianceMembers(
  members: MemberInput[],
  thresholds?: Partial<RallyThresholds>
): CategorizedMember[];

export function summarizeRallyRoles(
  categorized: CategorizedMember[]
): RallyRoleSummary;

export function deriveThresholdsFromRoster(
  samples: Array<Pick<MemberInput, "apc1_cp"> | Pick<MemberInput, "apc1_cp" | "rally_capacity">>
): RallyThresholds & { sampleApc: number };

export function median(values: number[]): number;

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
