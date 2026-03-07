"use client";

import { useEffect, useState } from "react";
import { getSortedPlayers } from "@/lib/tournament";
import type { PlayerStats, TournamentData } from "@/types/tournament";
import PlayerCard from "@/components/PlayerCard";

const REFRESH_MS = 60_000;
const DATA_URL = "https://raw.githubusercontent.com/mattwhiteley/shamevision/main/data/tournament.json";

export default function Home() {
  const [data, setData] = useState<TournamentData | null>(null);
  const [players, setPlayers] = useState<PlayerStats[]>([]);

  async function fetchData() {
    try {
      const res = await fetch(DATA_URL + "?t=" + Date.now());
      const json: TournamentData = await res.json();
      setData(json);
      setPlayers(getSortedPlayers(json));
    } catch (e) {
      console.error("Failed to fetch tournament data", e);
    }
  }

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--text-2)" }}>Loading…</div>;

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
          <span className="status-bar__refresh">Checks for scores every 5min</span>
        </div>
      </div>

      {/* ── Cards ── */}
      <main className="main">
        <div className="grid">
          {players.map((stats) => (
            <PlayerCard
              key={stats.player.id}
              stats={stats}
              currentRound={data.currentRound}
              totalRounds={data.totalRounds}
              roundInProgress={data.roundInProgress}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
