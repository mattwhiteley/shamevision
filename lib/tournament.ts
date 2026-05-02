import type {
  Member,
  TournamentEvent,
  EventPlayer,
  ResolvedPlayer,
  PlayerStats,
  RoundOutcome,
  TeamMatchupView,
  TeamRoundResult,
} from "@/types/tournament";
import rawMembersData from "@/data/members.json";
import rawEventsData from "@/data/events.json";

const LIVE_URL =
  process.env.NEXT_PUBLIC_LIVE_URL ??
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
  eventType?: "individual" | "team";
  teamRounds?: TeamRoundResult[];
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

// ---------------------------------------------------------------------------
// Team event helpers
// ---------------------------------------------------------------------------

export function isTeamEvent(event: TournamentEvent): boolean {
  return event.eventType === "team";
}

export function getTeamMatchupsForRound(
  event: TournamentEvent,
  memberMap: Map<string, string>,
  round: number,
): TeamMatchupView[] {
  if (!event.teamRounds) return [];

  // Unique teams visible in this round (club teams only)
  const roundTeamRows = event.teamRounds.filter((tr) => tr.round === round);
  const teamIds = [...new Set(roundTeamRows.map((tr) => tr.teamId))];

  return teamIds.map((teamId) => {
    const teamRow = roundTeamRows.find((tr) => tr.teamId === teamId)!;

    const teamScore = teamRow.teamScore;
    const oppScore = teamRow.opponentTeamScore;
    let outcome: TeamMatchupView["outcome"];
    if (teamScore === null || oppScore === null) {
      outcome = event.roundInProgress ? "in_progress" : "upcoming";
    } else {
      const diff = teamScore - oppScore;
      if (diff >= 10) outcome = "win";
      else if (diff <= -10) outcome = "loss";
      else outcome = "draw";
    }

    const isCurrentRound = round === event.currentRound;
    const teamPlayers = event.players
      .filter((p) => p.teamName === teamRow.teamName)
      .map((p) => resolvePlayer(p, memberMap))
      .map((p) => computePlayerStats(p, round, isCurrentRound && event.roundInProgress));

    return {
      teamId,
      teamName: teamRow.teamName,
      opponentTeamName: teamRow.opponentTeamName,
      teamScore,
      opponentTeamScore: oppScore,
      outcome,
      players: teamPlayers,
    };
  });
}

// ---------------------------------------------------------------------------
// Resolved events
// ---------------------------------------------------------------------------

export type ResolvedEvent = {
  event: TournamentEvent;
  players: PlayerStats[];
};

export async function getResolvedEvents(): Promise<ResolvedEvent[]> {
  const members = getMembers();
  const memberMap = buildMemberMap(members);
  const tierMap = new Map(members.map((m) => [m.id, m.tier]));
  const configs = getEventConfigs();
  const liveMap = await fetchLiveStateMap();

  const emptyLive: EventLiveState = {
    id: "",
    currentRound: 1,
    roundInProgress: false,
    updated_at: new Date().toISOString(),
    players: [],
  };

  return configs.map((config) => {
    const live = liveMap.get(config.id) ?? emptyLive;
    const players = live.players.map((p) => ({
      ...p,
      group: p.group ?? (tierMap.get(p.memberId) === "friends" ? "pile" : "hall") as EventPlayer["group"],
    }));
    const event = {
      ...config,
      currentRound: live.currentRound,
      roundInProgress: live.roundInProgress,
      updated_at: live.updated_at,
      players,
      ...(live.eventType ? { eventType: live.eventType } : {}),
      ...(live.teamRounds ? { teamRounds: live.teamRounds } : {}),
    } as TournamentEvent;
    return { event, players: getSortedPlayers(event, memberMap) };
  });
}
