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

EARLY_OPEN_MINS   = 150   # T+2h30m  start of scraping window
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
        last = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).astimezone(tz)
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


def build_live_state(
    event_config: dict,
    members: list[dict],
    all_rounds_data: dict[int, list],
    round_in_progress: bool,
) -> dict:
    """Builds the live state dict for a single event."""
    published_rounds = sorted(all_rounds_data.keys())
    current_round    = max(published_rounds) if published_rounds else 1

    players: dict[str, dict] = {}

    for round_num, pairings in all_rounds_data.items():
        for pairing in pairings:
            p1 = pairing.get("player1") or {}
            p2 = pairing.get("player2") or {}

            p1_score = to_score(pairing.get("player1Score"))
            p2_score = to_score(pairing.get("player2Score"))

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
                    players[pid] = {
                        "id":       pid,
                        "memberId": member["id"],
                        "faction":  faction,
                        "rounds":   {},
                    }
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

    player_list = [
        {
            "id":       p["id"],
            "memberId": p["memberId"],
            "faction":  p["faction"],
            "rounds":   [p["rounds"][r] for r in sorted(p["rounds"])],
        }
        for p in sorted(players.values(), key=lambda x: x["memberId"])
    ]

    return {
        "id":              event_config["id"],
        "currentRound":    current_round,
        "roundInProgress": round_in_progress,
        "updated_at":      datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "players":         player_list,
    }


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

    # Fetch all published rounds
    total_rounds = event_config["totalRounds"]
    all_rounds: dict[int, list] = {}

    for r in range(1, total_rounds + 1):
        print(f"    Fetching round {r}...", end=" ", flush=True)
        try:
            pairings = fetch_round(event_id, r)
            if pairings:
                all_rounds[r] = pairings
                print(f"{len(pairings)} pairings")
            else:
                print("no data (round not yet published)")
                break
        except requests.HTTPError as e:
            print(f"HTTP {e.response.status_code} — stopping")
            break
        except Exception as e:
            print(f"error: {e} — stopping")
            break

    if not all_rounds:
        print(f"  ❌ {event_id}: no pairing data — skipping.")
        return None

    in_window, _, _ = get_active_window(event_config)
    round_in_progress = in_window or force

    live_state   = build_live_state(event_config, members, all_rounds, round_in_progress)
    found        = len(live_state["players"])
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
