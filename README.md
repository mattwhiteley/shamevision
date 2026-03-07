# ShameVision

Live Warhammer 40K tournament tracker. Sorted by wins, tap any card to expand round-by-round scores.

---

## Local dev

```bash
npm install
npm run dev   # → http://localhost:3000
```

## Deploy to Vercel

1. Push this repo to GitHub
2. Import into Vercel (it auto-detects Next.js)
3. Every push to `main` triggers a new deploy — usually live in ~30 seconds

---

## Updating the data

**Edit one file only: `data/tournament.json`**

Everything the site displays comes from this file. It's plain JSON — easy to write by hand or generate from any language.

### Top-level fields

```json
{
  "eventName":    "My GT 2026",
  "bcpUrl":       "https://www.bestcoastpairings.com/event/XXXX",
  "totalRounds":  5,
  "currentRound": 3,
  "players": [ ... ]
}
```

| Field          | What it does |
|----------------|-------------|
| `bcpUrl`       | The "See Event on BCP" button links here |
| `totalRounds`  | Controls how many round pip icons appear on each card |
| `currentRound` | Tells the site which round is active right now |

---

### Player fields

```json
{
  "id":      "1",
  "name":    "Alice Shephard",
  "faction": "Space Marines",
  "rounds":  [ ... ]
}
```

`id` just needs to be unique — use whatever your pairing software exports.

---

### Round states

Each entry in `rounds` looks like this:

```json
{
  "round":           3,
  "opponent":        "Bob Krane",
  "opponentFaction": "Orks",
  "playerScore":     87,
  "opponentScore":   45
}
```

| Situation | How to represent it |
|-----------|-------------------|
| **Result known** (W/L/D) | Set both scores to integers. Equal scores = Draw. |
| **Round in progress** (spinning icon) | Set both scores to `null` |
| **Round not yet paired** | Don't include that round number in the `rounds` array |
| **Bye** | Set `opponent` to `"BYE"` — scores are ignored |

---

### Between rounds workflow

1. Set `currentRound` to the new round number
2. For every player, add their new round entry with `"playerScore": null, "opponentScore": null`
3. `git commit -am "Round X pairings" && git push`
4. Vercel deploys in ~30 seconds — the page auto-reloads every 60 seconds

### Entering results

As results come in, update each player's round entry with the actual scores and push again.

---

## Auto-refresh

The page reloads every 60 seconds. To change the interval, edit `AUTO_REFRESH_INTERVAL` (in milliseconds) near the top of `app/page.tsx`.

---

## Sorting

Players are sorted: **most wins first**, then **alphabetically by name** among equal win counts.
