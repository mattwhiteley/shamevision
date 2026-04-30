"use client";

import type { TournamentEvent, PlayerStats } from "@/types/tournament";
import PlayerCard from "./PlayerCard";
import TeamEventContainer from "./TeamEventContainer";

type Props = {
  event: TournamentEvent;
  players: PlayerStats[];
};

export default function EventContainer({ event, players }: Props) {
  if (event.eventType === "team") {
    return <TeamEventContainer event={event} players={players} />;
  }
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
      <div className="group-heading">Hall of Shame</div>
      <div className="grid">
        {players
          .filter((s) => s.player.group !== "pile")
          .map((stats) => (
            <PlayerCard
              key={stats.player.id}
              stats={stats}
              currentRound={event.currentRound}
              totalRounds={event.totalRounds}
              roundInProgress={event.roundInProgress}
            />
          ))}
      </div>
      {players.some((s) => s.player.group === "pile") && (
        <>
          <div className="group-heading">Friends of the Pile</div>
          <div className="grid">
            {players
              .filter((s) => s.player.group === "pile")
              .map((stats) => (
                <PlayerCard
                  key={stats.player.id}
                  stats={stats}
                  currentRound={event.currentRound}
                  totalRounds={event.totalRounds}
                  roundInProgress={event.roundInProgress}
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
