export type Member = {
  id: string;
  name: string;
  shortName: string;
  tier: "hall-of-shame" | "friends";
};

export type EventType = "individual" | "team";

export type RoundResult = {
  round: number;
  opponent: string;
  opponentFaction: string;
  /** null = result not yet entered. Use "BYE" as opponent name for byes. */
  playerScore: number | null;
  opponentScore: number | null;
};

export type EventPlayer = {
  id: string;
  memberId: string;
  faction: string;
  group: "hall" | "pile";
  rounds: RoundResult[];
  /** Team name from BCP — only set for team events */
  teamName?: string;
};

export type TeamRoundResult = {
  round: number;
  /** Slugified team name used as a stable ID */
  teamId: string;
  teamName: string;
  opponentTeamName: string;
  /** Aggregate team score (sum of 5 individual games), 0–100 */
  teamScore: number | null;
  opponentTeamScore: number | null;
};

export type TournamentEvent = {
  id: string;
  shortName: string;
  eventName: string;
  bcpUrl: string;
  totalRounds: number;
  currentRound: number;
  /** True when the current round is actively being played (within the time window) */
  roundInProgress: boolean;
  /** ISO 8601 datetime string, e.g. "2026-03-07T14:35:00" */
  updated_at: string;
  players: EventPlayer[];
  /** Defaults to "individual" when absent */
  eventType?: EventType;
  /** Aggregate team scores per round — only present for team events */
  teamRounds?: TeamRoundResult[];
};

/** EventPlayer with name resolved from the members registry — used in UI components */
export type ResolvedPlayer = EventPlayer & {
  name: string;
};

export type RoundOutcome =
  | "win"
  | "loss"
  | "draw"
  | "bye"
  | "in_progress"
  | "upcoming"
  | "pending";

export type PlayerStats = {
  player: ResolvedPlayer;
  wins: number;
  losses: number;
  draws: number;
  outcomes: RoundOutcome[];
  currentRoundData: RoundResult | null;
};

/** Per-team matchup data for a single round — used by TeamMatchupCard */
export type TeamMatchupView = {
  teamId: string;
  teamName: string;
  opponentTeamName: string;
  teamScore: number | null;
  opponentTeamScore: number | null;
  outcome: "win" | "loss" | "draw" | "in_progress" | "upcoming";
  players: PlayerStats[];
};
