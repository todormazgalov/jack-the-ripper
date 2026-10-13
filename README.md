# Jack the Ripper

A personal, non-commercial digital version of the board game *Letters from Whitechapel*
(base rules of the revised edition). One player is Jack, the others are detectives.
Everyone plays in their own browser, so Jack's moves stay truly hidden.

## Run it

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`, create a game and share the room link. Other players on your
network use the LAN address printed by the server (`http://<your-pc-ip>:3000`). To play over the
internet, expose port 3000 with a tunnel such as `cloudflared tunnel --url http://localhost:3000`
or `ngrok http 3000`.

Each browser tab is a separate player, so you can test alone with two tabs.

## Bots (single player)

On the home page, pick a difficulty and press **Play Jack vs bot police** or **Play the police vs
bot Jack** to start a solo game right away. In a lobby the host can also **Add a bot** to fill any
seat (change its role, policemen or difficulty like any other player). Bots play from their own
player's view only, so they never see hidden information. They act about 0.7 s apart so you can
follow along (`BOT_DELAY_MS` changes that).

### Difficulty levels

All levels reason from the same deductions. Lower levels add noise to their judgement and
sometimes make a plain mistake. Expert plays differently:

- **Expert police** plan all their policemen together, and from the second night they wall in
  the likely hideouts (Jack's last move home must be a walk, so a hideout with every street held is
  unreachable).
- **Expert Jack** predicts where the police will strike, keeps escape routes open, hurries home when
  the police are close to guessing it, and sometimes walks past his hideout as a bluff.

Measured with the bot arena (200 games per matchup), Jack's win rate:

| Level | Police at this level vs Hard Jack | Jack at this level vs Hard police |
|---|---|---|
| Easy | 59% | 11% |
| Normal | 41% | 24% |
| Hard | 37% | 37% |
| Expert | 17% | 43% |

Expert vs Expert: Jack wins 27%. To rerun it: `npm run arena -w shared -- <games per worker> <jack level> <police level>`
(4 workers in parallel).

### Final hideout guess

A lobby option (on by default). If Jack escapes on the fourth night, the Head of the
Investigation's player names one circle. If it is Jack's hideout, the police win; otherwise
Jack wins. The bots guess with the hideout deduction, which takes three things into account:
- every night ended there;
- Jack usually goes home at his first chance;
- the real targets are rarely far from home.

### Animations

Searches, arrest attempts and the final raid are animated on the board:
- **Search:** a magnifying glass travels from the policeman, then "CLUE!" or "nothing" appears.
- **Arrest:** a closing ring and "ARREST!", then "Nobody!" or "ARRESTED!".
- **Final raid:** a lantern beam over the guessed circle.

The **Animations** button on the board turns them off for your browser.

How they think (`shared/src/bot/`):

- The engine keeps a public *trail* per night: crime scenes, the kind of each Jack move, the
  policemen's positions at each walk, and every search and arrest result.
- From it the detectives work out every route Jack could have taken, so they know how likely each
  circle is to be his location or on his path. Finished nights narrow down the hideout.
- Detective bots close in on the likely locations, search where the trail probably passed and arrest
  when the odds are good. As Head of the Investigation they place real policemen near the women
  and lead the wretched towards them.
- The Jack bot runs the same deduction on each of its possible moves and picks the one that keeps
  him hidden among many possible locations, out of reach of policemen and with time to get home.
  It uses coaches and alleys when they help.

Running games are saved to `saves/rooms.json` and survive a server restart. If you close a tab,
use "Rejoin room ... as before" on the home page.

Development: `npm run dev` (Vite on :5173 with hot reload, game server on :3000).
Tests: `npm test`. Typecheck: `npm run typecheck`.

## How a turn works in the UI

Everything you can click right now pulses in cyan. The panel on the right explains the current step.

| Phase | Who | What to do |
|---|---|---|
| Hideout | Jack | Click any non-red circle (or press **Random hideout**, again to re-roll), confirm |
| Women | Jack | Click the red circles that hold the *real* targets |
| Patrols | Head of the Investigation | Pick a token (colour or fake) and click a crossing; click a placed token to take it back |
| Kill / Wait | Jack | Click the victim(s) and press Kill, or press Wait |
| Wretched | Head of the Investigation | Click a wretched, then its destination |
| Reveal | Jack | Click a face-down patrol token |
| Escape | Jack | Walk / Coach (two clicks) / Alley; walking onto the hideout asks whether to escape |
| Hunting | Detectives | Move each policeman (or Stay put), then Search (click circles one at a time) / Arrest / No action |

Use the mouse wheel to zoom and drag to pan. **Fit** resets the view.

## Map data

`shared/src/map/whitechapel.json` holds the board in board-image pixels (1200×803):
195 circles (8 red), 234 crossings (7 yellow, plus Goulston Street), 18 plain line junctions,
596 street segments, and the house blocks used for Alley moves.

The map was extracted from the two reference images with the scripts in `tools/` (OpenCV).
It was then checked against the independent `whitechapelR` dataset (CRAN, MIT license) in
`shared/test/map.test.ts`:

- Circle adjacency agrees on 765 of 767 pairs.
- Block (alley) connections agree on 450 of 452 pairs.
- Every difference was checked by eye on the board; those are errors in that dataset.

**Map editor:** open `/editor` to inspect connections. Click a circle to see its walking
neighbours (cyan) and alley neighbours (orange). Click a crossing to see its police steps and
the circles it watches. You can also drag nodes and add or remove segments, then download the
JSON to replace the shipped file.

## Not included yet (v2)

The optional rules: Jack's Letters, False Clues, Rushing, Area Arrests, Catch Me If You Can,
I Know Your Address. The data model already marks Goulston Street for the Letters.
