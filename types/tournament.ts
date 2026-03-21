export type RoundResult = {
  round: number;
  opponent: string;
  opponentFaction: string;
  /** null = result not yet entered. Use "BYE" as opponent name for byes. */
  playerScore: number | null;
  opponentScore: number | null;
};

export type Player = {
  id: string;
  name: string;
  faction: string;
  group: "hall" | "pile";
  rounds: RoundResult[];
};

export type TournamentData = {
  eventName: string;
  bcpUrl: string;
  totalRounds: number;
  currentRound: number;
  /** True when the current round is actively being played (within the time window) */
  roundInProgress: boolean;
  /** ISO 8601 datetime string, e.g. "2026-03-07T14:35:00" */
  updated_at: string;
  players: Player[];
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
  player: Player;
  wins: number;
  losses: number;
  draws: number;
  outcomes: RoundOutcome[];
  currentRoundData: RoundResult | null;
};
