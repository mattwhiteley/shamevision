"use client";

import { useEffect, useState } from "react";
import { getTournamentData, getSortedPlayers } from "@/lib/tournament";
import type { PlayerStats, TournamentData } from "@/types/tournament";
import PlayerCard from "@/components/PlayerCard";

const REFRESH_MS = 60_000;

export default function Home() {
  const [data] = useState<TournamentData>(getTournamentData);
  const [players, setPlayers] = useState<PlayerStats[]>([]);

  useEffect(() => {
    setPlayers(getSortedPlayers(data));
  }, [data]);

  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), REFRESH_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="page">
      {/* ── Header ── */}
      <header className="header">
        <div className="header__inner">
          <div className="header__left">
            <div className="logo">
              <span className="logo__shame">SHAME</span>
              <span className="logo__vision">VISION</span>
            </div>

            <div className="header__meta">
              <span className="meta__event">{data.eventName}</span>
              <span className="meta__round">
                Round <strong>{data.currentRound}</strong> of {data.totalRounds}
              </span>
            </div>
          </div>

          <a
            href={data.bcpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bcp-btn"
          >
            See Event on BCP
            <svg viewBox="0 0 12 12" fill="none" width="11" height="11" aria-hidden="true">
              <path d="M2 2h8v8M2 10L10 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </a>
        </div>
      </header>

      {/* ── Status bar ── */}
      <div className="status-bar">
        <div className="status-bar__inner">
          <span className="status-bar__updated">
            Last updated:{" "}
            <strong>
              {new Date(data.updated_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
          </span>
          <span className="status-bar__count">{players.length} players</span>
          <span className="status-bar__refresh">Auto-refreshes every 60s</span>
        </div>
      </div>

      {/* ── Cards ── */}
      <main className="main">
        <div className="grid">
          {players.map((stats, i) => (
            <PlayerCard
              key={stats.player.id}
              stats={stats}
              currentRound={data.currentRound}
              totalRounds={data.totalRounds}
              rank={i + 1}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
