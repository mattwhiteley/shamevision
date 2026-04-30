"use client";

import type { TeamMatchupView } from "@/types/tournament";
import PlayerCard from "./PlayerCard";

type Props = {
  matchup: TeamMatchupView;
  /** The round being displayed (may differ from event.currentRound when filter is applied) */
  displayRound: number;
  totalRounds: number;
  roundInProgress: boolean;
};

const BADGE_LABELS = {
  win: "WIN",
  loss: "LOSS",
  draw: "DRAW",
  in_progress: "LIVE",
  upcoming: "UPCOMING",
};

export default function TeamMatchupCard({
  matchup,
  displayRound,
  totalRounds,
  roundInProgress,
}: Props) {
  const { teamName, opponentTeamName, teamScore, opponentTeamScore, outcome, players } = matchup;
  const hasScores = teamScore !== null && opponentTeamScore !== null;

  return (
    <div className={`team-matchup team-matchup--${outcome}`}>
      <div className="team-matchup__header">
        <div className="team-matchup__names">
          <span className="team-matchup__our-team">{teamName}</span>
          <span className="team-matchup__vs">vs</span>
          <span className="team-matchup__opp-team">{opponentTeamName || "TBD"}</span>
        </div>
        <div className="team-matchup__result">
          {hasScores ? (
            <span className="team-matchup__score">
              <strong className={`team-score team-score--${outcome}`}>{teamScore}</strong>
              <span className="team-score__sep">–</span>
              <span className="team-score__opp">{opponentTeamScore}</span>
            </span>
          ) : null}
          <span className={`team-matchup__badge team-matchup__badge--${outcome}`}>
            {BADGE_LABELS[outcome]}
          </span>
        </div>
      </div>

      <div className="team-matchup__players">
        {players.map((stats) => (
          <PlayerCard
            key={stats.player.id}
            stats={stats}
            currentRound={displayRound}
            totalRounds={totalRounds}
            roundInProgress={roundInProgress}
          />
        ))}
      </div>
    </div>
  );
}
