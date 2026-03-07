import type { Player, PlayerStats, RoundOutcome, TournamentData } from "@/types/tournament";
import rawData from "@/data/tournament.json";

export function getTournamentData(): TournamentData {
  return rawData as TournamentData;
}

export function getOutcome(
  playerScore: number | null,
  opponentScore: number | null,
  opponent: string,
  isCurrentRound: boolean
): RoundOutcome {
  if (opponent === "BYE") return "bye";
  if (playerScore === null || opponentScore === null) {
    return isCurrentRound ? "in_progress" : "pending";
  }
  if (playerScore > opponentScore) return "win";
  if (playerScore < opponentScore) return "loss";
  return "draw";
}

export function computePlayerStats(
  player: Player,
  currentRound: number
): PlayerStats {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const outcomes: RoundOutcome[] = [];

  for (const round of player.rounds) {
    const outcome = getOutcome(
      round.playerScore,
      round.opponentScore,
      round.opponent,
      round.round === currentRound
    );
    outcomes.push(outcome);
    if (outcome === "win" || outcome === "bye") wins++;
    else if (outcome === "loss") losses++;
    else if (outcome === "draw") draws++;
  }

  const currentRoundData =
    player.rounds.find((r) => r.round === currentRound) ?? null;

  return { player, wins, losses, draws, outcomes, currentRoundData };
}

export function getSortedPlayers(data: TournamentData): PlayerStats[] {
  return data.players
    .map((p) => computePlayerStats(p, data.currentRound))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.draws !== a.draws) return b.draws - a.draws;
      return a.player.name.localeCompare(b.player.name);
    });
}
