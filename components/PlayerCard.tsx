"use client";

import { useState } from "react";
import type { PlayerStats, RoundOutcome } from "@/types/tournament";
import { getOutcome } from "@/lib/tournament";

type Props = {
  stats: PlayerStats;
  currentRound: number;
  totalRounds: number;
  roundInProgress: boolean;
};

const OUTCOME_ICONS: Record<RoundOutcome, React.ReactNode> = {
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
  bye: (
    <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  pending: (
    <span style={{ fontSize: "10px", lineHeight: 1 }}>·</span>
  ),
};

const OUTCOME_LABELS: Record<RoundOutcome, string> = {
  win: "Win",
  loss: "Loss",
  draw: "Draw",
  bye: "Bye",
  in_progress: "Live",
  upcoming: "Soon",
  pending: "—",
};

function RoundPip({
  roundNum,
  outcome,
}: {
  roundNum: number;
  outcome: RoundOutcome;
}) {
  return (
    <div className={`round-pip round-pip--${outcome}`}>
      <div className="round-pip__icon">{OUTCOME_ICONS[outcome]}</div>
      <span className="round-pip__label">R{roundNum}</span>
    </div>
  );
}

export default function PlayerCard({
  stats,
  currentRound,
  totalRounds,
  roundInProgress,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const { player, wins, losses, draws, currentRoundData } = stats;

  const isBye = currentRoundData?.opponent === "BYE";

  return (
    <div
      className={`card${wins >= 2 ? " card--podium" : ""}${expanded ? " card--expanded" : ""}`}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
      aria-expanded={expanded}
    >
      {/* ── Header: name + W-L record ── */}
      <div className="card__header">
        <div className="card__identity">
          <h2 className="card__name">{player.name}</h2>
          <span className="card__faction">{player.faction}</span>
        </div>
        <div className="card__record">
          <span className="record__num record__num--wins">{wins}</span>
          <span className="record__sep">–</span>
          <span className="record__num record__num--losses">{losses}</span>
          {draws > 0 && (
            <>
              <span className="record__sep">–</span>
              <span className="record__num record__num--draws">{draws}</span>
            </>
          )}
          <span className="record__label">
            W–L{draws > 0 ? "–D" : ""}
          </span>
        </div>
      </div>

      {/* ── Round icons ── */}
      <div className="card__rounds">
        {Array.from({ length: totalRounds }, (_, i) => {
          const rNum = i + 1;
          const rd = player.rounds.find((r) => r.round === rNum);
          const outcome: RoundOutcome = rd
            ? getOutcome(rd.playerScore, rd.opponentScore, rd.opponent, rNum === currentRound, roundInProgress)
            : "pending";
          return <RoundPip key={rNum} roundNum={rNum} outcome={outcome} />;
        })}
      </div>

      {/* ── Current matchup ── */}
      <div className="card__matchup">
        {currentRoundData ? (
          isBye ? (
            <div className="matchup__bye">Round {currentRound} · Bye</div>
          ) : (
            <>
              <span className="matchup__label">Rd {currentRound}</span>
              <span className="matchup__vs">vs</span>
              <span className="matchup__opponent">{currentRoundData.opponent}</span>
              <span className="matchup__faction">{currentRoundData.opponentFaction}</span>
            </>
          )
        ) : (
          <span className="matchup__label matchup__label--none">
            Rd {currentRound} · Awaiting pairing
          </span>
        )}
      </div>

      {/* ── Expanded: round-by-round scores ── */}
      {expanded && (
        <div
          className="card__history"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="history__title">Results</div>
          <div className="history__table">
            {player.rounds.map((rd) => {
              const outcome = getOutcome(
                rd.playerScore,
                rd.opponentScore,
                rd.opponent,
                rd.round === currentRound,
                roundInProgress,
              );
              const resolved =
                rd.playerScore !== null && rd.opponentScore !== null;
              const isByeRound = rd.opponent === "BYE";
              return (
                <div key={rd.round} className={`history__row history__row--${outcome}`}>
                  <span className="history__rnum">Rd {rd.round}</span>
                  <div className="history__opp-block">
                    <span className="history__opp">
                      {isByeRound ? "Bye" : `vs ${rd.opponent}`}
                    </span>
                    {!isByeRound && (
                      <span className="history__opp-faction">{rd.opponentFaction}</span>
                    )}
                  </div>
                  <span className="history__outcome-label">
                    {OUTCOME_LABELS[outcome]}
                  </span>
                  {resolved && !isByeRound ? (
                    <span className="history__score">
                      <strong className={`score--${outcome === "win" ? "win" : outcome === "loss" ? "loss" : "draw"}`}>
                        {rd.playerScore}
                      </strong>
                      <span className="score__sep">–</span>
                      <span>{rd.opponentScore}</span>
                    </span>
                  ) : (
                    <span className="history__score history__score--pending">
                      {rd.round === currentRound && !isByeRound ? "in progress" : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Tap hint ── */}
      <button className="card__toggle" aria-hidden="true" tabIndex={-1}>
        {expanded ? "Hide results ▲" : "Show results ▼"}
      </button>
    </div>
  );
}
