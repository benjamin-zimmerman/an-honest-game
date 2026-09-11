# The Noble Game

A portable chess artwork. The playing page presents an ordinary game; the post-game audit reveals any unrecorded moves.

## Play

Open `index.html`, or serve the folder for background analysis:

```sh
node scripts/serve.cjs
```

Visit http://127.0.0.1:8792/. No packages, accounts, API keys, or build step are required. To use another port, set the `PORT` environment variable. The server binds to the local computer only.

## Opponent

Each human move is compared with alternatives from its actual starting position, using completed search iterations. The opponent estimates recent move error and targets a modestly greater error when choosing its own legal moves. Forced moves provide no calibration evidence. The estimate persists across rematches in the same tab and resets on a page reload.

This is adaptive handicapping, not an Elo rating or a proof that every machine move is weaker. Discrete choices, forced moves, search limits, and an imperfect estimate prevent that literal guarantee.

Analysis runs in `engine-worker.js` so the board and New game button stay responsive. Opening the files directly, or a worker failure, uses a smaller analysis budget on the page. New game and resignation cancel pending work.

## Private interventions

- Relocate one existing black piece to an adjacent empty square.
- Preserve the entire piece inventory and all white pieces.
- Never create, remove, capture, or promote a piece during an intervention.
- Preserve bishops' square colour; never move a pawn backward or onto a promotion rank.
- Leave both kings safe before Black's ordinary recorded move.
- Revoke affected castling rights and clear stale en-passant state.
- Prefer a useful, modest positional improvement or an escape from a threat.
- Increase pressure when losing ground, facing check, or facing a mating threat. Time alone never forces a cheat.
- Allow at most four shifts, separated by at least six full moves. Reserve the fourth for a mating threat. A first mating emergency can bypass the five-move opening grace period.
- Apply a shift alongside the ordinary move with no special highlight, twitch, or announcement.
- Reveal exact squares and the situational motive in the post-game audit.

The rare, adjacent-only restrictions take priority in this version. They cannot guarantee a machine win in every possible chess position. If a bounded rescue is unavailable, the game reports the actual checkmate or draw; it never rewrites the result. A guaranteed win would require different rules.

## Verify

```sh
node --test tests/core.test.cjs
node tests/simulate.cjs
```

The tests cover move generation, inventory preservation, relocation distance, king safety, castling, en-passant, cheat limits, mate rescue, impossible rescue, calibration, bounded search, and legal planned turns. The playthrough script exercises six synthetic player profiles/seeds with short search budgets; it is a behavior check, not a strength or win-rate benchmark.

## Hosting

Deploy the repository as a static site with no framework or build command and the repository root as the output directory. Include `index.html`, `style.css`, all four `app-*.js` files, and `engine-worker.js`. The existing `vercel.json` supplies URL behavior. The new title does not change the GitHub repository's name.
