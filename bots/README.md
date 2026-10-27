# Temporary game test bots

Run the command from the project root after opening the target room in the game:

```text
node bots/run-tests.js <game> <room-code> [bot-count]
```

Supported games: `dilemmas`, `whofrom`, `court`, `bets`, `fakenews`, `mafia`, `teli`, `quiplash`, `spy`, and `memology`.

Spy bots just sit in the circle (the game is spoken aloud); each round the console prints which bots are spies and the word the others got. Charades bots only act as encoders (guessing is spoken aloud): they think 6–20 s and send 2–4 random emoji, then listen 12–25 s and mark one or two humans as guessers (sometimes nobody). Memology bots throw a meme 3–15 s into the round and vote for someone else's meme. The default is three bots; for example:

```text
node bots/run-tests.js whofrom ROOM42 3
```

Bots join only an existing room in its lobby. They do not create rooms, start games, or change settings. Keep the command running while testing; press Ctrl+C to remove the temporary players and their test data. If the process is closed unexpectedly, their presence expires after the normal game timeout. If stopped during an active Fake News round, its photos stay in the room until the host returns to the lobby so the remaining screens can display them; the game clears them on return.

Fake News bots upload two small JPEG test images (under 100 KB) from `memes/` apiece so they are ready when the host starts.

The original Mafia bot remains available as `node bots/mafia.js <room-code>`.

Up to 20 players per room (people + bots). To test without touching the real database, see `bots/local-sim/README.md`.
