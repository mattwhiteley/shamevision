"use client";

import { useEffect, useState } from "react";
import { getResolvedEvents } from "@/lib/tournament";
import type { ResolvedEvent } from "@/lib/tournament";
import FilterPillBar from "@/components/FilterPillBar";
import EventContainer from "@/components/EventContainer";

const REFRESH_MS = 60_000;

export default function Home() {
  const [resolvedEvents] = useState<ResolvedEvent[]>(getResolvedEvents);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), REFRESH_MS);
    return () => clearTimeout(t);
  }, []);

  const visibleEvents = activeEventId
    ? resolvedEvents.filter((e) => e.event.id === activeEventId)
    : resolvedEvents;

  const pillData = resolvedEvents.map((e) => ({
    id: e.event.id,
    shortName: e.event.shortName,
    playerCount: e.players.length,
  }));

  return (
    <div className="page">
      <div className="sticky-band">
        {/* ── Header ── */}
        <header className="header">
          <div className="header__inner">
            <div className="logo">
              <span className="logo__shame">SHAME</span>
              <span className="logo__vision">VISION</span>
            </div>
          </div>
        </header>

        {/* ── Filter pills ── */}
        <FilterPillBar
          events={pillData}
          activeEventId={activeEventId}
          onSelect={setActiveEventId}
        />
      </div>

      {/* ── Event containers ── */}
      <main className="main">
        {visibleEvents.map(({ event, players }) => (
          <EventContainer key={event.id} event={event} players={players} />
        ))}
      </main>
    </div>
  );
}
