const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { request, patch, wait } = require("./common");
const { gameActions } = require("./game-actions");

const POLL_MS = 750;
const HEARTBEAT_MS = 2000;
const MAX_ROOM_PLAYERS = 20;
const MIN_PLAYERS = {
  humanbingo: 2,
  dilemmas: 2,
  whofrom: 3,
  court: 3,
  bets: 3,
  charades: 3,
  fakenews: 3,
  naklep: 4,
  mafia: 4,
};
const GAME_KEYS = {
  humanbingo: "humanbingo",
  dilemmas: "dilemmas",
  whofrom: "party_whofrom",
  court: "party_court",
  bets: "party_bets",
  charades: "charades",
  fakenews: "fakenews",
  naklep: "naklep",
  mafia: "mafia",
};
const BOT_FACTS = [
  "засинав(ла) під час фільму в кінотеатрі",
  "їздив(ла) не тим автобусом і помітив(ла) це не одразу",
  "забував(ла), навіщо зайшов або зайшла в кімнату",
  "ховав(ла) смаколики від друзів",
  "проспав(ла) зупинку в транспорті",
  "плутав(ла) ліву і праву сторону",
  "співав(ла) пісню, не знаючи слів",
  "купував(ла) річ, а потім забував(ла) нею користуватися",
  "надсилав(ла) повідомлення не в той чат",
  "шукав(ла) окуляри, які були на голові",
  "запізнювався(лася), бо довго шукав(ла) ключі",
  "вигадував(ла) відмовку, щоб не йти на вечірку",
];
const NAKLEP_FACTS = [
  "Одного разу я привітався з манекеном у магазині",
  "Я шукав телефон, поки тримав його в руці",
  "Я кивав, хоча не почув запитання",
  "Я відкривав холодильник, забувши, що саме шукаю",
  "Я махав знайомій людині, а вона махала комусь позаду мене",
  "Я гуглив значення слова, яке щойно сам написав",
  "Я зайшов у кімнату й одразу забув навіщо",
  "Я кілька разів перевіряв, чи замкнув двері",
  "Я сказав «і тобі смачного» офіціанту, який побажав гарного дня",
  "Я шукав окуляри, поки вони були на моїй голові",
  "Я відкрив не ті двері в під'їзді",
  "Я пішов не в той бік після виходу з ліфта",
];
const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];

function usage() {
  console.log("Usage: node bots/run-tests.js <game> <room-code> [bot-count]");
  console.log("Games: humanbingo, dilemmas, whofrom, court, bets, charades, fakenews, naklep, mafia");
  console.log("Example: node bots/run-tests.js charades ROOM42 3");
}

function makeBots(count) {
  const runId = randomUUID().slice(0, 8);
  return Array.from({ length: count }, (_, index) => ({
    name: `testbot_${runId}_${String(index + 1).padStart(2, "0")}`,
    index,
    cleanup: [],
  }));
}

async function findTestPhotos() {
  const dir = path.resolve(__dirname, "..", "memes");
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
  throw new Error("Fake News needs two local JPEG test images smaller than 100 KB in memes/.");
}

async function prepareBot(game, roomId, bot, currentPlayers, photoFiles) {
  const now = Date.now() + bot.index;
  const avatarNumber = (currentPlayers.length + bot.index) % AVATAR_COLORS.length;
  const player = {
    joinedAt: now,
    lastSeen: now,
    status: "active",
    character: (avatarNumber % 8) + 1,
    color: AVATAR_COLORS[avatarNumber],
    ...(game === "mafia" ? { role: null, isDon: false, alive: true, ready: false } : {}),
  };
  await request(`${GAME_KEYS[game]}_rooms/${roomId}/players/${bot.name}`, "PUT", player);
  bot.cleanup.push(`players/${bot.name}`);

  if (game === "humanbingo") {
    for (let index = 0; index < 4; index++) {
      const id = `${bot.name}_${index + 1}`;
      await request(`${GAME_KEYS[game]}_rooms/${roomId}/factPool/facts/${id}`, "PUT", {
        text: BOT_FACTS[(bot.index * 4 + index) % BOT_FACTS.length],
        authorUsername: bot.name,
        level: 3,
        status: "approved",
        similarTo: null,
        createdAt: now + index,
        sessionId: null,
        playCount: 0,
        lastPlayedAt: null,
        lastPlayedSession: null,
      });
      bot.cleanup.push(`factPool/facts/${id}`);
    }
  } else if (game === "naklep") {
    for (let index = 0; index < 4; index++) {
      const id = `testfact_${index + 1}`;
      await request(`${GAME_KEYS[game]}_rooms/${roomId}/facts/${bot.name}/${id}`, "PUT",
        NAKLEP_FACTS[(bot.index * 4 + index) % NAKLEP_FACTS.length]);
      bot.cleanup.push(`facts/${bot.name}/${id}`);
    }
  } else if (game === "fakenews") {
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

async function run(game, roomId, count) {
  if (!/^[A-Za-z0-9_-]+$/.test(roomId)) {
    throw new Error("Room code may contain only letters, digits, hyphens, and underscores.");
  }
  const key = GAME_KEYS[game];
  const initialRoom = await request(`${key}_rooms/${roomId}`);
  if (!initialRoom) throw new Error(`Room ${roomId} does not exist in ${key}_rooms.`);
  if ((initialRoom.phase || "lobby") !== "lobby") {
    throw new Error(`Room must be in the lobby before starting test bots (current phase: ${initialRoom.phase}).`);
  }

  const bots = makeBots(count);
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
      await prepareBot(game, roomId, bot, existingPlayers, photoFiles);
      console.log(`Joined ${roomId} as ${bot.name}`);
      await wait(150);
    }

    const required = MIN_PLAYERS[game];
    if (existingPlayers.length + bots.length < required) {
      throw new Error(`${game} needs ${required} connected players; room has ${existingPlayers.length + bots.length}. Run with more bots.`);
    }
    if (existingPlayers.length + bots.length > MAX_ROOM_PLAYERS) {
      throw new Error(`This test runner supports up to ${MAX_ROOM_PLAYERS} connected players; room would have ${existingPlayers.length + bots.length}.`);
    }

    console.log(`Ready. Start the game manually in the browser. Press Ctrl+C to remove these bots.`);
    while (!stopping) {
      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_MS) {
        const heartbeat = { lastActivityAt: now };
        for (const bot of bots) {
          heartbeat[`players/${bot.name}/lastSeen`] = now;
          heartbeat[`players/${bot.name}/status`] = "active";
        }
        await patch(`${key}_rooms/${roomId}`, heartbeat);
        lastHeartbeat = now;
      }

      const room = await request(`${key}_rooms/${roomId}`);
      if (!room) throw new Error("The room was removed while test bots were running.");
      const result = gameActions(game, room, bots, now);
      if (Object.keys(result.updates).length) {
        await patch(`${key}_rooms/${roomId}`, result.updates);
        const signature = `${room.phase}:${room.stage && room.stage.id}:${result.actions.join("|")}`;
        if (signature !== lastActionSignature) {
          console.log(result.actions.join("; "));
          lastActionSignature = signature;
        }
      }
      await wait(POLL_MS);
    }
  } finally {
    await cleanup();
  }
}

async function main() {
  const [, , gameArg, roomId, countArg] = process.argv;
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
  await run(game, roomId, count);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { run, GAME_KEYS, MIN_PLAYERS };
