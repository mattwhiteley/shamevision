import type { Player, PlayerStats, RoundOutcome, TournamentData } from "@/types/tournament";

export function getOutcome(
  playerScore: number | null,
  opponentScore: number | null,
  opponent: string,
  isCurrentRound: boolean,
  roundInProgress: boolean = true,
): RoundOutcome {
  if (opponent === "BYE") return "bye";
  if (playerScore === null || opponentScore === null) {
    if (!isCurrentRound) return "pending";
    return roundInProgress ? "in_progress" : "upcoming";
  }
  if (playerScore > opponentScore) return "win";
  if (playerScore < opponentScore) return "loss";
  return "draw";
}

export function computePlayerStats(
  player: Player,
  currentRound: number,
  roundInProgress: boolean,
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
      round.round === currentRound,
      roundInProgress,
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

function sortStats(stats: PlayerStats[]): PlayerStats[] {
  return stats.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.draws !== a.draws) return b.draws - a.draws;
    return a.player.name.localeCompare(b.player.name);
  });
}

export function getSortedPlayers(data: TournamentData): { hall: PlayerStats[]; pile: PlayerStats[] } {
  const all = data.players.map((p) => computePlayerStats(p, data.currentRound, data.roundInProgress));
  return {
    hall: sortStats(all.filter((s) => s.player.group === "hall")),
    pile: sortStats(all.filter((s) => s.player.group === "pile")),
  };
}
