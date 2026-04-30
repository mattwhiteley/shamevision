"use client";

import { useState } from "react";
import type { TournamentEvent, PlayerStats } from "@/types/tournament";
import { getTeamMatchupsForRound } from "@/lib/tournament";
import TeamMatchupCard from "./TeamMatchupCard";

type Props = {
  event: TournamentEvent;
  players: PlayerStats[];
};

export default function TeamEventContainer({ event, players }: Props) {
  const [selectedRound, setSelectedRound] = useState(event.currentRound);

  // Build member map from resolved player names for getTeamMatchupsForRound
  const memberMap = new Map(players.map((s) => [s.player.memberId, s.player.name]));
  const matchups = getTeamMatchupsForRound(event, memberMap, selectedRound);

  const uniqueTeams = new Set(event.players.map((p) => p.teamName).filter(Boolean));

  return (
    <div className="event-container">
      <div className="event-header">
        <div className="event-header__left">
          <h2 className="event-title">{event.eventName}</h2>
          <div className="event-meta">
            <span className="event-round">
              Round <strong>{event.currentRound}</strong> of {event.totalRounds}
            </span>
            <span className="event-sep">·</span>
            <span className="event-count">{players.length} players</span>
            <span className="event-sep">·</span>
            <span className="event-count">{uniqueTeams.size} teams</span>
            <span className="event-sep">·</span>
            <span className="event-updated">
              Updated{" "}
              <strong>
                {new Date(event.updated_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </strong>
            </span>
          </div>
        </div>
        <a
          href={event.bcpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bcp-btn"
        >
          See Event on BCP
          <svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
            <path
              d="M2 2h8v8M2 10L10 2"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </a>
      </div>

      {/* Round filter pills */}
      <div className="team-round-filter">
        {Array.from({ length: event.totalRounds }, (_, i) => {
          const r = i + 1;
          const isActive = r === selectedRound;
          const isCurrent = r === event.currentRound;
          return (
            <button
              key={r}
              className={`pill${isActive ? " pill--active" : ""}`}
              onClick={() => setSelectedRound(r)}
            >
              Round {r}
              {isCurrent && !isActive && (
                <span className="pill__badge">live</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Team matchups for selected round */}
      {matchups.length === 0 ? (
        <div className="team-no-data">No pairings yet for Round {selectedRound}.</div>
      ) : (
        matchups.map((matchup) => (
          <TeamMatchupCard
            key={matchup.teamId}
            matchup={matchup}
            displayRound={selectedRound}
            totalRounds={event.totalRounds}
            roundInProgress={event.roundInProgress && selectedRound === event.currentRound}
          />
        ))
      )}
    </div>
  );
}
