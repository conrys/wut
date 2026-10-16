const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { request, patch, wait } = require("./common");
const { gameActions } = require("./game-actions");
const { doodleDataUri } = require("./doodle-png");

const POLL_MS = 750;
const HEARTBEAT_MS = 2000;
const MAX_ROOM_PLAYERS = 20;
const MIN_PLAYERS = {
  dilemmas: 2,
  whofrom: 3,
  court: 3,
  bets: 3,
  charades: 3,
  fakenews: 3,
  mafia: 4,
  teli: 2,
  quiplash: 2,
};
const GAME_KEYS = {
  dilemmas: "dilemmas",
  whofrom: "party_whofrom",
  court: "party_court",
  bets: "party_bets",
  charades: "charades",
  fakenews: "fakenews",
  mafia: "mafia",
  teli: "teli",
  quiplash: "quiplash",
};
const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];

function usage() {
  console.log("Usage: node bots/run-tests.js <game> <room-code> [bot-count]");
  console.log("Games: dilemmas, whofrom, court, bets, charades, fakenews, mafia, teli, quiplash");
  console.log("Example: node bots/run-tests.js charades ROOM42 3");
  console.log("Resume bots already in a running game: node bots/run-tests.js fakenews 1 2 --resume a4679ffc");
}

function makeBots(count, resumeId) {
  const runId = resumeId || randomUUID().slice(0, 8);
  return Array.from({ length: count }, (_, index) => ({
    name: `testbot_${runId}_${String(index + 1).padStart(2, "0")}`,
    index,
    cleanup: [],
  }));
}

async function findTestPhotos() {
  // окремі тестові JPEG: меми й фото гри тепер у WebP, а правила бази приймають лише JPEG
  const dir = path.resolve(__dirname, "fixtures");
  const names = await fs.readdir(dir);
  const photos = [];
  for (const name of names.sort()) {
    // RTDB rules for fakenews_photos accept only data:image/jpeg under 150000 chars.
    if (!/\.jpe?g$/i.test(name)) continue;
    const filePath = path.join(dir, name);
    const data = await fs.readFile(filePath);
    if (data.length > 100_000) continue;
    photos.push({
      dataUri: `data:image/jpeg;base64,${data.toString("base64")}`,
    });
    if (photos.length === 2) return photos;
  }
  throw new Error("Fake News needs two local JPEG test images smaller than 100 KB in bots/fixtures/.");
}

async function prepareBot(game, roomId, bot, currentPlayers, photoFiles) {
  const now = Date.now() + bot.index;
  const avatarNumber = (currentPlayers.length + bot.index) % AVATAR_COLORS.length;
  const player = {
    joinedAt: now,
    lastSeen: now,
    status: "active",
    character: game === "quiplash" ? ((currentPlayers.length + bot.index) % 20) + 1 : (avatarNumber % 8) + 1,
    color: AVATAR_COLORS[avatarNumber],
    ...(game === "mafia" ? { role: null, isDon: false, alive: true, ready: false } : {}),
    ...(game === "quiplash" ? { score: 0 } : {}),
  };
  await request(`${GAME_KEYS[game]}_rooms/${roomId}/players/${bot.name}`, "PUT", player);
  bot.cleanup.push(`players/${bot.name}`);

  if (game === "fakenews") {
    for (let index = 0; index < photoFiles.length; index++) {
      const id = `testphoto_${index + 1}`;
      await request(`fakenews_photos/${roomId}/${bot.name}/${id}`, "PUT", photoFiles[index].dataUri);
      await request(`${GAME_KEYS[game]}_rooms/${roomId}/photoMeta/${bot.name}/${id}`, "PUT", true);
    }
    bot.cleanup.push(`photoMeta/${bot.name}`);
  }
}

async function cleanupBots(game, roomId, bots) {
  const roomPath = `${GAME_KEYS[game]}_rooms/${roomId}`;
  const room = await request(roomPath);
  const preserveFakeNewsPhotos = game === "fakenews" && room?.phase === "round";
  const roomUpdates = {};
  for (const bot of bots) {
    for (const key of bot.cleanup) {
      if (!(preserveFakeNewsPhotos && key === `photoMeta/${bot.name}`)) roomUpdates[key] = null;
    }
  }
  if (room && Object.keys(roomUpdates).length) await patch(roomPath, roomUpdates);
  if (game === "fakenews" && !preserveFakeNewsPhotos) {
    for (const bot of bots) await request(`fakenews_photos/${roomId}/${bot.name}`, "DELETE");
  }
  if (preserveFakeNewsPhotos) {
    console.log("Fake News round is active; its test images will stay available until the host returns to the lobby.");
  }
}

async function run(game, roomId, count, resumeId) {
  if (!/^[A-Za-z0-9_-]+$/.test(roomId)) {
    throw new Error("Room code may contain only letters, digits, hyphens, and underscores.");
  }
  const key = GAME_KEYS[game];
  const initialRoom = await request(`${key}_rooms/${roomId}`);
  if (!initialRoom) throw new Error(`Room ${roomId} does not exist in ${key}_rooms.`);
  if (!resumeId && (initialRoom.phase || "lobby") !== "lobby") {
    throw new Error(`Room must be in the lobby before starting test bots (current phase: ${initialRoom.phase}). Щоб підхопити ботів, що вже в грі: --resume <id>`);
  }

  const bots = makeBots(count, resumeId);
  let stopping = false;
  let cleaned = false;
  let lastHeartbeat = 0;
  let lastActionSignature = "";

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      await cleanupBots(game, roomId, bots);
      console.log("Test bots removed from the room.");
    } catch (error) {
      console.error("Could not remove every test bot:", error.message);
    }
  }

  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  try {
    const photoFiles = game === "fakenews" ? await findTestPhotos() : null;
    const existingPlayers = Object.entries(initialRoom.players || {})
      .filter(([, player]) => player.status !== "inactive" && Date.now() - (player.lastSeen || 0) < 120_000)
      .map(([name]) => name);

    for (const bot of bots) {
      if (resumeId && initialRoom.players && initialRoom.players[bot.name]) {
        // --resume: бот уже в кімнаті (посеред гри) — просто знову ходимо за нього
        bot.cleanup.push(`players/${bot.name}`);
        if (game === "fakenews") bot.cleanup.push(`photoMeta/${bot.name}`);
        console.log(`Resumed ${bot.name}`);
        continue;
      }
      await prepareBot(game, roomId, bot, existingPlayers, photoFiles);
      console.log(`Joined ${roomId} as ${bot.name}`);
      await wait(150);
    }

    const required = MIN_PLAYERS[game];
    if (!resumeId && existingPlayers.length + bots.length < required) {
      throw new Error(`${game} needs ${required} connected players; room has ${existingPlayers.length + bots.length}. Run with more bots.`);
    }
    if (existingPlayers.length + bots.length > MAX_ROOM_PLAYERS) {
      throw new Error(`This test runner supports up to ${MAX_ROOM_PLAYERS} connected players; room would have ${existingPlayers.length + bots.length}.`);
    }

    console.log(`Ready. Start the game manually in the browser. Press Ctrl+C to remove these bots.`);
    let failures = 0;
    while (!stopping) {
      try {
      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_MS) {
        const heartbeat = { lastActivityAt: now };
        const current = (await request(`${key}_rooms/${roomId}/players`)) || {};
        for (const bot of bots) {
          if (!current[bot.name]) {
            // кімнату скинули і бота прибрали — заходить заново повним записом
            // (зі свіжим joinedAt), а не голим lastSeen, з яким він виглядав би «найстаршим»
            await prepareBot(game, roomId, { ...bot, cleanup: [] }, Object.keys(current), photoFiles);
            continue;
          }
          heartbeat[`players/${bot.name}/lastSeen`] = now;
          heartbeat[`players/${bot.name}/status`] = "active";
        }
        await patch(`${key}_rooms/${roomId}`, heartbeat);
        lastHeartbeat = now;
      }

      const room = await request(`${key}_rooms/${roomId}`);
      if (!room) throw new Error("The room was removed while test bots were running.");
      const result = gameActions(game, room, bots, now);
      // малюнки (Телефон) — спершу в окремий вузол, потім посилання в кімнату
      for (const d of result.drawings || []) {
        await request(`teli_drawings/${roomId}/${d.ref}`, "PUT", doodleDataUri(d.seed));
      }
      if (Object.keys(result.updates).length) {
        await patch(`${key}_rooms/${roomId}`, result.updates);
        const signature = `${room.phase}:${room.stage && room.stage.id}:${result.actions.join("|")}`;
        if (signature !== lastActionSignature) {
          console.log(result.actions.join("; "));
          lastActionSignature = signature;
        }
      }
      failures = 0;
      } catch (error) {
        // збій мережі не має вбивати ботів посеред гри — пробуємо ще ~2 хв
        if (/removed while/.test(error.message) || ++failures > 60) throw error;
        if (failures === 1 || failures % 10 === 0) console.log(`Network hiccup (${error.message}), retrying… [${failures}]`);
        await wait(2000);
        continue;
      }
      await wait(POLL_MS);
    }
  } finally {
    await cleanup();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--resume");
  const resumeId = ri >= 0 ? args.splice(ri, 2)[1] : null;
  const [gameArg, roomId, countArg] = args;
  if (!gameArg || !roomId || !/^[1-9]\d*$/.test(countArg || "3")) {
    usage();
    process.exitCode = 2;
    return;
  }
  const game = gameArg.toLowerCase();
  const count = Number(countArg || 3);
  if (!GAME_KEYS[game]) {
    usage();
    throw new Error(`Unsupported test game: ${gameArg}`);
  }
  if (count > MAX_ROOM_PLAYERS) throw new Error(`Bot count cannot exceed ${MAX_ROOM_PLAYERS}.`);
  await run(game, roomId, count, resumeId);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, GAME_KEYS, MIN_PLAYERS };
