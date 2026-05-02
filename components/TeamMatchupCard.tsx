"use client";

import type { TeamMatchupView, TeamRoundResult } from "@/types/tournament";
import PlayerCard from "./PlayerCard";

type TeamRoundOutcome = "win" | "loss" | "draw" | "in_progress" | "upcoming" | "pending";

type Props = {
  matchup: TeamMatchupView;
  /** The round being displayed (may differ from event.currentRound when filter is applied) */
  displayRound: number;
  totalRounds: number;
  roundInProgress: boolean;
  allTeamRounds: TeamRoundResult[];
  currentRound: number;
};

const BADGE_LABELS = {
  win: "WIN",
  loss: "LOSS",
  draw: "DRAW",
  in_progress: "LIVE",
  upcoming: "UPCOMING",
};

const TEAM_PIP_ICONS: Record<TeamRoundOutcome, React.ReactNode> = {
  win: (
    <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
      <path d="M2.5 8.5L6 12l7.5-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  loss: (
    <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  draw: (
    <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
      <path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  in_progress: (
    <svg viewBox="0 0 16 16" fill="none" width="13" height="13" className="spin-icon">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.75" strokeDasharray="9 6" strokeLinecap="round" />
    </svg>
  ),
  upcoming: (
    <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pending: <span style={{ fontSize: "10px", lineHeight: 1 }}>·</span>,
};

function computeTeamRoundOutcome(
  tr: TeamRoundResult | undefined,
  round: number,
  currentRound: number,
  roundInProgress: boolean,
): TeamRoundOutcome {
  if (!tr) return round < currentRound ? "pending" : "upcoming";
  const { teamScore, opponentTeamScore } = tr;
  if (teamScore === null || opponentTeamScore === null) {
    return round === currentRound && roundInProgress ? "in_progress" : "upcoming";
  }
  const diff = teamScore - opponentTeamScore;
  if (diff >= 10) return "win";
  if (diff <= -10) return "loss";
  return "draw";
}

function TeamRoundPip({ roundNum, outcome }: { roundNum: number; outcome: TeamRoundOutcome }) {
  return (
    <div className={`round-pip round-pip--${outcome}`}>
      <div className="round-pip__icon">{TEAM_PIP_ICONS[outcome]}</div>
      <span className="round-pip__label">R{roundNum}</span>
    </div>
  );
}

export default function TeamMatchupCard({
  matchup,
  displayRound,
  totalRounds,
  roundInProgress,
  allTeamRounds = [],
  currentRound,
}: Props) {
  const { teamId, teamName, opponentTeamName, teamScore, opponentTeamScore, outcome, players } = matchup;
  const hasScores = teamScore !== null && opponentTeamScore !== null;

  const roundByNum = new Map(
    allTeamRounds.filter((tr) => tr.teamId === teamId).map((tr) => [tr.round, tr]),
  );

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

      <div className="team-matchup__rounds">
        {Array.from({ length: totalRounds }, (_, i) => {
          const r = i + 1;
          const o = computeTeamRoundOutcome(
            roundByNum.get(r),
            r,
            currentRound,
            roundInProgress && r === currentRound,
          );
          return <TeamRoundPip key={r} roundNum={r} outcome={o} />;
        })}
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
