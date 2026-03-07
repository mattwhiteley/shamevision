#!/usr/bin/env python3
"""
BCP Scraper for ShameVision
============================
Fetches pairings and scores from the BCP REST API and writes tournament.json.

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
time against schedule.json and exits immediately (code 0) if outside an
active window — so it's a no-op most of the day.

Per-round scraping windows (relative to round start time):
  T+2h30m → T+2h50m   run if ≥5 mins since last scrape
  T+2h50m → T+3h10m   run if ≥2 mins since last scrape
  Outside these        exit immediately, do nothing

Usage:
    python scripts/scrape_bcp.py           # normal mode (respects schedule)
    python scripts/scrape_bcp.py --force   # skip time-window check (for testing)
    python scripts/scrape_bcp.py --dry-run # print JSON without writing file
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

SCRIPTS_DIR   = Path(__file__).parent
REPO_ROOT     = SCRIPTS_DIR.parent
SCHEDULE_PATH = SCRIPTS_DIR / "schedule.json"
OUTPUT_PATH   = REPO_ROOT / "data" / "tournament.json"

# ---------------------------------------------------------------------------
# BCP API
# ---------------------------------------------------------------------------

BCP_API_URL = (
    "https://newprod-api.bestcoastpairings.com/v1/events/{event_id}/pairings"
    "?eventId={event_id}&round={round}&pairingType=Pairing"
)

BCP_HEADERS = {
    "client-id":      "web-app",
    "env":            "bcp",
    "accept":         "application/json",
    "content-type":   "application/json",
    "origin":         "https://www.bestcoastpairings.com",
    "referer":        "https://www.bestcoastpairings.com/",
    "user-agent":     (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/145.0.0.0 Safari/537.36"
    ),
}

# ---------------------------------------------------------------------------
# Scheduling constants
# ---------------------------------------------------------------------------

EARLY_OPEN_MINS  = 150   # T+2h30m  start of scraping window
LATE_START_MINS  = 170   # T+2h50m  switch to faster cadence
WINDOW_CLOSE_MINS = 190  # T+3h10m  end of scraping window

EARLY_CADENCE_MINS = 5
LATE_CADENCE_MINS  = 2

# ---------------------------------------------------------------------------
# Schedule helpers
# ---------------------------------------------------------------------------

def load_schedule() -> dict:
    with open(SCHEDULE_PATH, encoding="utf-8") as f:
        return json.load(f)


def normalise_name(name: str) -> str:
    """Lowercase, strip accents and extra whitespace for fuzzy matching."""
    name = name.strip().lower()
    name = "".join(
        c for c in __import__("unicodedata").normalize("NFD", name)
        if __import__("unicodedata").category(c) != "Mn"
    )
    return name


def names_match(bcp_first: str, bcp_last: str, tracked_name: str) -> bool:
    """
    Flexible match between BCP 'firstName lastName' and our tracked name list.
    Handles:
      - Simple full-name match: 'Alex Ford'
      - Single-word last name only: 'Harvey R'
      - Emojis / decorations in BCP names (e.g. 'Byron 🔥🎲 Sidhu')
    """
    import re
    # Strip emoji and non-alpha characters from BCP name for comparison
    def clean(s: str) -> str:
        s = re.sub(r"[^\w\s]", "", s, flags=re.UNICODE)
        return normalise_name(s)

    bcp_full  = clean(f"{bcp_first} {bcp_last}")
    tracked   = clean(tracked_name)

    # Direct full-name match
    if tracked == bcp_full:
        return True

    # Tracked name is first + just initial of last (e.g. "Harvey R")
    parts = tracked.split()
    if len(parts) == 2 and len(parts[1]) == 1:
        if clean(bcp_first) == parts[0] and clean(bcp_last).startswith(parts[1]):
            return True

    return False


def is_tracked(player_data: dict, tracked_names: list[str]) -> bool:
    user = player_data.get("user", {})
    first = user.get("firstName", "")
    last  = user.get("lastName", "")
    return any(names_match(first, last, t) for t in tracked_names)


def display_name(player_data: dict, tracked_names: list[str]) -> str:
    """
    Returns the name as it appears in tracked_players list (preserving
    the human-chosen spelling), falling back to BCP's name if not tracked.
    """
    user  = player_data.get("user", {})
    first = user.get("firstName", "")
    last  = user.get("lastName", "")
    for t in tracked_names:
        if names_match(first, last, t):
            return t
    return f"{first} {last}".strip()


def get_active_window(schedule: dict) -> tuple[bool, int | None, int]:
    """
    Returns (should_run, active_round_number, cadence_minutes).
    Checks if now falls within any round's scraping window.
    """
    tz  = ZoneInfo(schedule["timezone"])
    now = datetime.now(tz)

    for entry in schedule["rounds"]:
        start   = datetime.fromisoformat(entry["start"]).replace(tzinfo=tz)
        elapsed = (now - start).total_seconds() / 60

        if elapsed < EARLY_OPEN_MINS or elapsed > WINDOW_CLOSE_MINS:
            continue

        cadence = LATE_CADENCE_MINS if elapsed >= LATE_START_MINS else EARLY_CADENCE_MINS
        return True, entry["round"], cadence

    return False, None, 0


def minutes_since_last_update(output_path: Path, tz: ZoneInfo) -> float | None:
    """Returns minutes since the last successful scrape, or None if unknown."""
    if not output_path.exists():
        return None
    try:
        data = json.loads(output_path.read_text(encoding="utf-8"))
        ts   = data.get("updated_at")
        if not ts:
            return None
        last = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).astimezone(tz)
        return (datetime.now(tz) - last).total_seconds() / 60
    except Exception:
        return None


# ---------------------------------------------------------------------------
# BCP API fetcher
# ---------------------------------------------------------------------------

def fetch_round(event_id: str, round_num: int) -> list[dict]:
    """Fetch all pairings for a single round. Returns list of pairing objects."""
    url = BCP_API_URL.format(event_id=event_id, round=round_num)
    resp = requests.get(url, headers=BCP_HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return data.get("active", [])


# ---------------------------------------------------------------------------
# Data builder
# ---------------------------------------------------------------------------

def full_name_from_player(p: dict) -> str:
    user = p.get("user", {})
    return f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()


def faction_from_player(p: dict) -> str:
    return (p.get("faction") or p.get("parentFaction") or "").strip()


def to_score(value) -> int | None:
    """Convert a score value to int, or None if absent/zero-sentinel."""
    try:
        v = int(value)
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None


def build_tournament_json(schedule: dict, all_rounds_data: dict[int, list], round_in_progress: bool) -> dict:
    """
    Builds the full tournament.json structure from raw BCP pairing data.

    Only includes players whose names appear in tracked_players.
    Non-tracked opponents are shown by name only (for context in the UI).
    """
    tracked_names = schedule["tracked_players"]
    total_rounds  = schedule["total_rounds"]

    # Determine which rounds have been published (have at least one pairing)
    published_rounds = sorted(all_rounds_data.keys())
    current_round    = max(published_rounds) if published_rounds else 1

    # player_id (BCP participant id) → accumulated data
    players: dict[str, dict] = {}

    for round_num, pairings in all_rounds_data.items():
        for pairing in pairings:
            p1 = pairing.get("player1") or {}
            p2 = pairing.get("player2") or {}

            # Scores — BCP uses player1Game.points / player2Game.points
            p1_game  = pairing.get("player1Game") or {}
            p2_game  = pairing.get("player2Game") or {}
            p1_score = to_score(p1_game.get("points"))
            p2_score = to_score(p2_game.get("points"))

            for my_side, their_side, my_score, their_score in [
                (p1, p2, p1_score, p2_score),
                (p2, p1, p2_score, p1_score),
            ]:
                if not my_side:
                    continue
                if not is_tracked(my_side, tracked_names):
                    continue

                pid  = my_side["id"]
                name = display_name(my_side, tracked_names)
                fac  = faction_from_player(my_side)

                if pid not in players:
                    players[pid] = {
                        "id":      pid,
                        "name":    name,
                        "faction": fac,
                        "rounds":  {},
                    }
                elif not players[pid]["faction"] and fac:
                    players[pid]["faction"] = fac

                # Opponent — may not be tracked, just show their name
                if their_side:
                    opp_name    = full_name_from_player(their_side)
                    opp_faction = faction_from_player(their_side)
                else:
                    opp_name    = "BYE"
                    opp_faction = ""

                players[pid]["rounds"][round_num] = {
                    "round":           round_num,
                    "opponent":        opp_name,
                    "opponentFaction": opp_faction,
                    "playerScore":     my_score,
                    "opponentScore":   their_score,
                }

    # Serialise — sort rounds into lists, sort players by name
    player_list = []
    for p in sorted(players.values(), key=lambda x: x["name"]):
        player_list.append({
            "id":      p["id"],
            "name":    p["name"],
            "faction": p["faction"],
            "rounds":  [p["rounds"][r] for r in sorted(p["rounds"])],
        })

    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    return {
        "eventName":       schedule["event_name"],
        "bcpUrl":          schedule["bcp_url"],
        "totalRounds":     total_rounds,
        "currentRound":    current_round,
        "roundInProgress": round_in_progress,
        "updated_at":      now_utc,
        "players":         player_list,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Scrape BCP event into tournament.json")
    parser.add_argument("--force",   action="store_true", help="Skip time-window check")
    parser.add_argument("--dry-run", action="store_true", help="Print JSON, don't write")
    args = parser.parse_args()

    schedule = load_schedule()
    tz       = ZoneInfo(schedule["timezone"])

    # ── Time-window check ──────────────────────────────────────────────────
    if not args.force:
        in_window, active_round, cadence = get_active_window(schedule)

        if not in_window:
            print("💤 Outside all scraping windows — exiting.")
            sys.exit(0)

        mins_ago = minutes_since_last_update(OUTPUT_PATH, tz)
        if mins_ago is not None and mins_ago < cadence:
            print(
                f"⏭  Last scraped {mins_ago:.1f}m ago "
                f"(cadence: every {cadence}m) — exiting."
            )
            sys.exit(0)

        print(f"🔍 Active window: round {active_round}, cadence={cadence}m")
    else:
        print("⚡ --force: skipping time-window check")

    # ── Fetch all published rounds ─────────────────────────────────────────
    event_id     = schedule["event_id"]
    total_rounds = schedule["total_rounds"]
    all_rounds: dict[int, list] = {}

    for r in range(1, total_rounds + 1):
        print(f"  Fetching round {r}...", end=" ", flush=True)
        try:
            pairings = fetch_round(event_id, r)
            if pairings:
                all_rounds[r] = pairings
                print(f"{len(pairings)} pairings")
            else:
                print("no data (round not yet published)")
                break   # rounds are sequential — stop at first unpublished
        except requests.HTTPError as e:
            print(f"HTTP {e.response.status_code} — stopping")
            break
        except Exception as e:
            print(f"error: {e} — stopping")
            break

    if not all_rounds:
        print("❌ No pairing data retrieved — exiting without changes.")
        sys.exit(1)

    # ── Determine if current round is actively in progress ────────────────
    in_window, _, _ = get_active_window(schedule)
    round_in_progress = in_window or args.force

    # ── Build JSON ─────────────────────────────────────────────────────────
    result = build_tournament_json(schedule, all_rounds, round_in_progress)

    tracked_found = len(result["players"])
    expected      = len(schedule["tracked_players"])
    print(
        f"✅ Built JSON: round {result['currentRound']}/{total_rounds}, "
        f"{tracked_found}/{expected} tracked players found"
    )

    if tracked_found < expected:
        found_names = {p["name"] for p in result["players"]}
        missing     = [n for n in schedule["tracked_players"] if n not in found_names]
        print(f"  ⚠ Not yet paired (or name mismatch): {', '.join(missing)}")

    # ── Write or print ─────────────────────────────────────────────────────
    output = json.dumps(result, indent=2, ensure_ascii=False)

    if args.dry_run:
        print("\n── DRY RUN — tournament.json would be: ──")
        print(output)
    else:
        OUTPUT_PATH.write_text(output + "\n", encoding="utf-8")
        print(f"📝 Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
