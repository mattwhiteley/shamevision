#!/usr/bin/env python3
"""
BCP Scraper for ShameVision
============================
Fetches pairings and scores from the BCP REST API and writes data/live.json.

Reads:  data/events.json  — event config (BCP ID, schedule, timezone)
        data/members.json — tracked player registry
Writes: data/live.json    — runtime state (currentRound, players, scores)

API endpoint:
  GET https://newprod-api.bestcoastpairings.com/v1/events/{eventId}/pairings
      ?eventId={eventId}&round={n}&pairingType=Pairing

Required headers (no auth needed — public API):
  client-id: web-app
  env: bcp

Response shape: { "active": [ ...pairing objects... ] }

Smart scheduling
----------------
GitHub Actions runs this every 2 minutes, but the script checks the current
time against each event's schedule and only scrapes events currently within
an active window — so it's a no-op most of the day.

Per-round scraping windows (relative to round start time):
  T+2h30m → T+2h50m   run if ≥5 mins since last scrape
  T+2h50m → T+3h10m   run if ≥2 mins since last scrape
  Outside these        skip this event

Usage:
    python scripts/scrape_bcp.py                          # scrape all active events
    python scripts/scrape_bcp.py --force                  # skip time-window check
    python scripts/scrape_bcp.py --dry-run                # print JSON without writing
    python scripts/scrape_bcp.py --event-id AZFDANhFHJS6 # target a specific event
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

# Ensure emoji in print() works on Windows terminals with narrow encodings
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT    = Path(__file__).parent.parent
MEMBERS_PATH = REPO_ROOT / "data" / "members.json"
EVENTS_PATH  = REPO_ROOT / "data" / "events.json"
LIVE_PATH    = REPO_ROOT / "data" / "live.json"

# ---------------------------------------------------------------------------
# BCP API
# ---------------------------------------------------------------------------

BCP_API_URL = (
    "https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/pairings"
    "?eventId={event_id}&round={round}&pairingType=Pairing"
)

BCP_TEAM_PAIRING_URL = (
    "https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/pairings"
    "?eventId={event_id}&round={round}&pairingType=TeamPairing"
)

BCP_HEADERS = {
    "client-id":    "web-app",
    "env":          "bcp",
    "accept":       "application/json",
    "content-type": "application/json",
    "origin":       "https://www.bestcoastpairings.com",
    "referer":      "https://www.bestcoastpairings.com/",
    "user-agent":   (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/145.0.0.0 Safari/537.36"
    ),
}

# ---------------------------------------------------------------------------
# Scheduling constants
# ---------------------------------------------------------------------------

EARLY_OPEN_MINS   = 100   # T+2h30m  start of scraping window
LATE_START_MINS   = 170   # T+2h50m  switch to faster cadence
WINDOW_CLOSE_MINS = 240   # T+4h00m  end of scraping window (extra time for late score entry)

EARLY_CADENCE_MINS = 5
LATE_CADENCE_MINS  = 2

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_members() -> list[dict]:
    with open(MEMBERS_PATH, encoding="utf-8") as f:
        return json.load(f)["members"]


def load_events() -> list[dict]:
    with open(EVENTS_PATH, encoding="utf-8") as f:
        return json.load(f)["events"]


def load_live() -> dict:
    if not LIVE_PATH.exists():
        return {"events": []}
    with open(LIVE_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Name matching
# ---------------------------------------------------------------------------

def normalise_name(name: str) -> str:
    name = name.strip().lower()
    name = "".join(
        c for c in __import__("unicodedata").normalize("NFD", name)
        if __import__("unicodedata").category(c) != "Mn"
    )
    return name


def names_match(bcp_first: str, bcp_last: str, member_name: str) -> bool:
    import re
    def clean(s: str) -> str:
        s = re.sub(r"[^\w\s]", "", s, flags=re.UNICODE)
        return normalise_name(s)

    bcp_full = clean(f"{bcp_first} {bcp_last}")
    tracked  = clean(member_name)

    if tracked == bcp_full:
        return True

    parts = tracked.split()
    if len(parts) == 2 and len(parts[1]) == 1:
        if clean(bcp_first) == parts[0] and clean(bcp_last).startswith(parts[1]):
            return True

    return False


def find_member(bcp_first: str, bcp_last: str, members: list[dict]) -> dict | None:
    for member in members:
        if names_match(bcp_first, bcp_last, member["name"]):
            return member
    return None


# ---------------------------------------------------------------------------
# Schedule helpers
# ---------------------------------------------------------------------------

def get_active_window(event_config: dict) -> tuple[bool, int | None, int]:
    """
    Returns (should_run, active_round_number, cadence_minutes).
    Uses the event's own timezone and schedule.
    """
    tz  = ZoneInfo(event_config["timezone"])
    now = datetime.now(tz)

    for entry in event_config["schedule"]:
        start   = datetime.fromisoformat(entry["start"]).replace(tzinfo=tz)
        elapsed = (now - start).total_seconds() / 60

        if elapsed < EARLY_OPEN_MINS or elapsed > WINDOW_CLOSE_MINS:
            continue

        cadence = LATE_CADENCE_MINS if elapsed >= LATE_START_MINS else EARLY_CADENCE_MINS
        return True, entry["round"], cadence

        
    return False, None, 0


def minutes_since_last_update(live: dict, event_id: str, tz: ZoneInfo) -> float | None:
    event = next((e for e in live.get("events", []) if e["id"] == event_id), None)
    if not event:
        return None
    ts = event.get("updated_at")
    if not ts:
        return None
    try:
        last = datetime.fromisoformat(ts).replace(tzinfo=tz).astimezone(tz)
        print(last, datetime.now(tz))
        return (datetime.now(tz) - last).total_seconds() / 60
    except Exception:
        return None


# ---------------------------------------------------------------------------
# BCP API fetcher
# ---------------------------------------------------------------------------

def fetch_round(event_id: str, round_num: int) -> list[dict]:
    url  = BCP_API_URL.format(event_id=event_id, round=round_num)
    resp = requests.get(url, headers=BCP_HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.json().get("active", [])


def fetch_team_pairings_round(event_id: str, round_num: int) -> list[dict]:
    url  = BCP_TEAM_PAIRING_URL.format(event_id=event_id, round=round_num)
    resp = requests.get(url, headers=BCP_HEADERS, timeout=15)
    if resp.status_code == 409:   # event doesn't use team pairings
        return []
    resp.raise_for_status()
    return resp.json().get("active", [])


# ---------------------------------------------------------------------------
# Data builder
# ---------------------------------------------------------------------------

def full_name_from_player(p: dict) -> str:
    user = p.get("user", {})
    return f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()


def faction_from_player(p: dict) -> str:
    return (p.get("faction") or p.get("parentFaction") or "").strip()


def to_score(value) -> int | None:
    try:
        v = int(value)
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None


def slugify(name: str) -> str:
    """Convert a team name to a stable lowercase slug for use as teamId."""
    import re
    slug = normalise_name(name)
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    return slug


def build_team_rounds(
    all_team_pairings: dict[int, list],
    all_individual_pairings: dict[int, list],
    teams_config: list[dict],
) -> list[dict]:
    """
    Builds per-team aggregate scores per round for team events.

    Uses TeamPairing as the authoritative source for which club team faces
    which opponent each round. Individual Pairing data provides game scores.

    teams_config: list of { "name": str, "memberIds": [...] } from events.json.
    """
    club_team_names = {t["name"] for t in teams_config}

    # Index individual pairings by (round, teamPairingId) for fast lookup
    ind_by_tpid: dict[tuple[int, str], list[dict]] = {}
    for round_num, pairings in all_individual_pairings.items():
        for p in pairings:
            tpid = p.get("teamPairingId")
            if tpid:
                ind_by_tpid.setdefault((round_num, tpid), []).append(p)

    team_rounds: list[dict] = []

    for round_num, team_pairings in all_team_pairings.items():
        for tp in team_pairings:
            t1_name = (tp.get("teamPlayer1") or {}).get("name", "")
            t2_name = (tp.get("teamPlayer2") or {}).get("name", "")

            # Identify which side (if any) is a club team
            for our_name, opp_name in [(t1_name, t2_name), (t2_name, t1_name)]:
                if our_name not in club_team_names:
                    continue

                # Sum individual scores for this teamPairingId
                games       = ind_by_tpid.get((round_num, tp["id"]), [])
                team_total  = 0
                opp_total   = 0
                any_null    = False

                for game in games:
                    p1 = game.get("player1") or {}
                    p2 = game.get("player2") or {}
                    s1 = to_score((game.get("player1Game") or {}).get("points"))
                    s2 = to_score((game.get("player2Game") or {}).get("points"))

                    if p1.get("team") == our_name:
                        if s1 is None or s2 is None:
                            any_null = True
                        else:
                            team_total += s1
                            opp_total  += s2
                    elif p2.get("team") == our_name:
                        if s1 is None or s2 is None:
                            any_null = True
                        else:
                            team_total += s2
                            opp_total  += s1

                team_rounds.append({
                    "round":             round_num,
                    "teamId":            slugify(our_name),
                    "teamName":          our_name,
                    "opponentTeamName":  opp_name,
                    "teamScore":         None if (any_null or not games) else team_total,
                    "opponentTeamScore": None if (any_null or not games) else opp_total,
                })

    return sorted(team_rounds, key=lambda r: (r["round"], r["teamId"]))


def build_live_state(
    event_config: dict,
    members: list[dict],
    all_rounds_data: dict[int, list],
    round_in_progress: bool,
    all_team_pairings: dict[int, list] | None = None,
) -> dict:
    """Builds the live state dict for a single event."""
    is_team      = event_config.get("eventType") == "team"
    teams_config = event_config.get("teams", []) if is_team else []

    # Current round: prefer team pairings (available before individual pairings)
    team_rounds_set = sorted(all_team_pairings.keys()) if all_team_pairings else []
    ind_rounds_set  = sorted(all_rounds_data.keys())

    if team_rounds_set:
        current_round = max(team_rounds_set)
    elif ind_rounds_set:
        current_round = max(ind_rounds_set)
    else:
        current_round = 1

    # Build player entries from individual pairings
    players: dict[str, dict] = {}

    for round_num, pairings in all_rounds_data.items():
        for pairing in pairings:
            p1 = pairing.get("player1") or {}
            p2 = pairing.get("player2") or {}

            p1_score = to_score((pairing.get("player1Game") or {}).get("points"))
            p2_score = to_score((pairing.get("player2Game") or {}).get("points"))

            for my_side, their_side, my_score, their_score in [
                (p1, p2, p1_score, p2_score),
                (p2, p1, p2_score, p1_score),
            ]:
                if not my_side:
                    continue

                user   = my_side.get("user", {})
                first  = user.get("firstName", "")
                last   = user.get("lastName", "")
                member = find_member(first, last, members)
                if not member:
                    continue

                pid     = my_side["id"]
                faction = faction_from_player(my_side)

                if pid not in players:
                    entry = {
                        "id":       pid,
                        "memberId": member["id"],
                        "faction":  faction,
                        "group":    "pile" if member.get("tier") == "friends" else "hall",
                        "rounds":   {},
                    }
                    if is_team:
                        entry["teamName"] = my_side.get("team", "")
                    players[pid] = entry
                elif not players[pid]["faction"] and faction:
                    players[pid]["faction"] = faction

                opp_name    = full_name_from_player(their_side) if their_side else "BYE"
                opp_faction = faction_from_player(their_side) if their_side else ""

                players[pid]["rounds"][round_num] = {
                    "round":           round_num,
                    "opponent":        opp_name,
                    "opponentFaction": opp_faction,
                    "playerScore":     my_score,
                    "opponentScore":   their_score,
                }

    # For team events with config: add placeholder entries for configured members
    # who haven't appeared in individual pairings yet.
    if is_team and teams_config:
        found_member_ids = {p["memberId"] for p in players.values()}
        for team in teams_config:
            for member_id in team.get("memberIds", []):
                if member_id in found_member_ids:
                    continue
                member = next((m for m in members if m["id"] == member_id), None)
                if not member:
                    continue
                players[f"cfg-{member_id}"] = {
                    "id":       f"cfg-{member_id}",
                    "memberId": member_id,
                    "faction":  "",
                    "group":    "pile" if member.get("tier") == "friends" else "hall",
                    "teamName": team["name"],
                    "rounds":   {},
                }

    player_list = [
        {
            "id":       p["id"],
            "memberId": p["memberId"],
            "faction":  p["faction"],
            "group":    p["group"],
            **({"teamName": p["teamName"]} if is_team else {}),
            "rounds":   [p["rounds"][r] for r in sorted(p["rounds"])],
        }
        for p in sorted(players.values(), key=lambda x: x["memberId"])
    ]

    result: dict = {
        "id":              event_config["id"],
        "currentRound":    current_round,
        "roundInProgress": round_in_progress,
        "updated_at":      datetime.now(tz).strftime("%Y-%m-%dT%H:%M:%S"),
        "players":         player_list,
    }

    if is_team:
        result["eventType"]  = "team"
        result["teamRounds"] = build_team_rounds(
            all_team_pairings or {},
            all_rounds_data,
            teams_config,
        )

    return result


# ---------------------------------------------------------------------------
# Scrape one event
# ---------------------------------------------------------------------------

def scrape_event(
    event_config: dict,
    members: list[dict],
    live: dict,
    force: bool,
) -> dict | None:
    """
    Attempts to scrape a single event. Returns the new live state dict for
    that event, or None if scraping was skipped.
    """
    event_id = event_config["id"]
    tz       = ZoneInfo(event_config["timezone"])
    print (f"System time:{datetime.now(tz)}")
           
    if not force:
        in_window, active_round, cadence = get_active_window(event_config)

        if not in_window:
            print(f"  💤 {event_id}: outside scraping window — skipping.")
            return None

        mins_ago = minutes_since_last_update(live, event_id, tz)
        if mins_ago is not None and mins_ago < cadence:
            print(f"  ⏭  {event_id}: scraped {mins_ago:.1f}m ago (cadence {cadence}m) — skipping.")
            return None

        print(f"  🔍 {event_id}: active window, round {active_round}, cadence={cadence}m")
    else:
        print(f"  ⚡ {event_id}: --force")

    is_team      = event_config.get("eventType") == "team"
    total_rounds = event_config["totalRounds"]

    # Fetch all published rounds (individual pairings)
    all_rounds: dict[int, list] = {}

    for r in range(1, total_rounds + 1):
        print(f"    Fetching round {r} (individual)...", end=" ", flush=True)
        try:
            pairings = fetch_round(event_id, r)
            if pairings:
                all_rounds[r] = pairings
                print(f"{len(pairings)} pairings")
            else:
                print("no data yet")
                break
        except requests.HTTPError as e:
            print(f"HTTP {e.response.status_code} — stopping")
            break
        except Exception as e:
            print(f"error: {e} — stopping")
            break

    # For team events, also fetch TeamPairing data (available before individual pairings)
    all_team_pairings: dict[int, list] | None = None
    if is_team:
        all_team_pairings = {}
        for r in range(1, total_rounds + 1):
            print(f"    Fetching round {r} (team)...", end=" ", flush=True)
            try:
                team_pairings = fetch_team_pairings_round(event_id, r)
                if team_pairings:
                    all_team_pairings[r] = team_pairings
                    print(f"{len(team_pairings)} team pairings")
                else:
                    print("no data yet")
                    break
            except requests.HTTPError as e:
                print(f"HTTP {e.response.status_code} — stopping")
                break
            except Exception as e:
                print(f"error: {e} — stopping")
                break

        if not all_team_pairings and not all_rounds:
            print(f"  ❌ {event_id}: no pairing data — skipping.")
            return None
    elif not all_rounds:
        print(f"  ❌ {event_id}: no pairing data — skipping.")
        return None

    in_window, _, _ = get_active_window(event_config)
    round_in_progress = in_window

    live_state    = build_live_state(event_config, members, all_rounds, round_in_progress, all_team_pairings)
    found         = len(live_state["players"])
    total_members = len(members)
    print(f"  ✅ {event_id}: round {live_state['currentRound']}/{total_rounds}, {found}/{total_members} members found")

    if found < total_members:
        found_ids = {p["memberId"] for p in live_state["players"]}
        missing   = [m["name"] for m in members if m["id"] not in found_ids]
        print(f"     ⚠ Not yet paired: {', '.join(missing)}")

    return live_state


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Scrape BCP events into data/live.json")
    parser.add_argument("--force",    action="store_true", help="Skip time-window check")
    parser.add_argument("--dry-run",  action="store_true", help="Print JSON, don't write")
    parser.add_argument("--event-id", default=None,        help="Scrape only this BCP event ID")
    args = parser.parse_args()

    all_event_configs = load_events()
    members           = load_members()
    live              = load_live()

    # Filter to target event if specified
    if args.event_id:
        targets = [e for e in all_event_configs if e["id"] == args.event_id]
        if not targets:
            print(f"❌ Event '{args.event_id}' not found in events.json.")
            sys.exit(1)
    else:
        targets = all_event_configs

    print(f"Checking {len(targets)} event(s)...")

    # Build a map of current live states so we can update in place
    live_map: dict[str, dict] = {e["id"]: e for e in live.get("events", [])}
    any_updated = False

    for event_config in targets:
        new_state = scrape_event(event_config, members, live, args.force)
        if new_state:
            live_map[event_config["id"]] = new_state
            any_updated = True

    if not any_updated:
        print("Nothing updated.")
        return

    # Preserve order from events.json
    live["events"] = [
        live_map[e["id"]]
        for e in all_event_configs
        if e["id"] in live_map
    ]

    output = json.dumps(live, indent=2, ensure_ascii=False)

    if args.dry_run:
        print("\n── DRY RUN — live.json would be: ──")
        print(output)
    else:
        LIVE_PATH.write_text(output + "\n", encoding="utf-8")
        print(f"📝 Written to {LIVE_PATH}")


if __name__ == "__main__":
    main()
