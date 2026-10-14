# Temporary game test bots

Run the command from the project root after opening the target room in the game:

```text
node bots/run-tests.js <game> <room-code> [bot-count]
```

Supported games: `humanbingo`, `dilemmas`, `whofrom`, `court`, `bets`, `charades`, `fakenews`, `naklep`, and `mafia`. The default is three bots; for example:

```text
node bots/run-tests.js naklep ROOM42 3
```

Bots join only an existing room in its lobby. They do not create rooms, start games, or change settings. Keep the command running while testing; press Ctrl+C to remove the temporary players and their test data. If the process is closed unexpectedly, their presence expires after the normal game timeout. If stopped during an active Fake News round, its photos stay in the room until the host returns to the lobby so the remaining screens can display them; the game clears them on return.

Fake News bots upload two small JPEG test images (under 100 KB) from `memes/` apiece so they are ready when the host starts. Human Bingo bots contribute approved test facts and fill their card after the host starts the game; its real-world find-and-confirm activity still requires people.

The original Mafia bot remains available as `node bots/mafia.js <room-code>`.

Up to 20 players per room (people + bots). To test without touching the real database, see `bots/local-sim/README.md`.
