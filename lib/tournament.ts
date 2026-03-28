import type {
  Member,
  TournamentEvent,
  EventPlayer,
  ResolvedPlayer,
  PlayerStats,
  RoundOutcome,
} from "@/types/tournament";
import rawMembersData from "@/data/members.json";
import rawEventsData from "@/data/events.json";

const LIVE_URL =
  "https://raw.githubusercontent.com/mattwhiteley/shamevision/main/data/live.json";

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

type EventConfig = {
  id: string;
  shortName: string;
  eventName: string;
  bcpUrl: string;
  totalRounds: number;
};

type EventLiveState = {
  id: string;
  currentRound: number;
  roundInProgress: boolean;
  updated_at: string;
  players: EventPlayer[];
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export function getMembers(): Member[] {
  return rawMembersData.members as Member[];
}

function getEventConfigs(): EventConfig[] {
  return (rawEventsData as { events: EventConfig[] }).events;
}

async function fetchLiveStateMap(): Promise<Map<string, EventLiveState>> {
  const res = await fetch(`${LIVE_URL}?t=${Date.now()}`, { cache: "no-store" });
  const data = await res.json();
  const states = (data as { events: EventLiveState[] }).events;
  return new Map(states.map((s) => [s.id, s]));
}

// ---------------------------------------------------------------------------
// Stats / sorting
// ---------------------------------------------------------------------------

function buildMemberMap(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.id, m.name]));
}

export function resolvePlayer(
  player: EventPlayer,
  memberMap: Map<string, string>,
): ResolvedPlayer {
  return {
    ...player,
    name: memberMap.get(player.memberId) ?? `Unknown (${player.memberId})`,
  };
}

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
  player: ResolvedPlayer,
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

export function getSortedPlayers(
  event: TournamentEvent,
  memberMap: Map<string, string>,
): PlayerStats[] {
  return event.players
    .map((p) => resolvePlayer(p, memberMap))
    .map((p) => computePlayerStats(p, event.currentRound, event.roundInProgress))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.draws !== a.draws) return b.draws - a.draws;
      return a.player.name.localeCompare(b.player.name);
    });
}

export type ResolvedEvent = {
  event: TournamentEvent;
  players: PlayerStats[];
};

export async function getResolvedEvents(): Promise<ResolvedEvent[]> {
  const memberMap = buildMemberMap(getMembers());
  const configs = getEventConfigs();
  const liveMap = await fetchLiveStateMap();

  return configs.map((config) => {
    const live = liveMap.get(config.id) ?? {
      currentRound: 1,
      roundInProgress: false,
      updated_at: new Date().toISOString(),
      players: [],
    };
    const event = {
      ...config,
      currentRound: live.currentRound,
      roundInProgress: live.roundInProgress,
      updated_at: live.updated_at,
      players: live.players,
    } as TournamentEvent;
    return { event, players: getSortedPlayers(event, memberMap) };
  });
}
