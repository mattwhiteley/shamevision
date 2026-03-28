"use client";

type PillItem = {
  id: string;
  shortName: string;
  playerCount: number;
};

type Props = {
  events: PillItem[];
  activeEventId: string | null;
  onSelect: (id: string | null) => void;
};

export default function FilterPillBar({ events, activeEventId, onSelect }: Props) {
  return (
    <div className="pill-bar">
      <div className="pill-bar__inner">
        <button
          className={`pill${activeEventId === null ? " pill--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          All
        </button>
        {events.map((e) => (
          <button
            key={e.id}
            className={`pill${activeEventId === e.id ? " pill--active" : ""}`}
            onClick={() => onSelect(e.id)}
          >
            {e.shortName}
            <span className="pill__badge">{e.playerCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
