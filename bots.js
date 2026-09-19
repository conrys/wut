/**
 * Робочий бот для Firebase RTDB (REST API)
 * Запуск: node bots.js SMM22
 */

const DB_URL = "https://kzl-crm-default-rtdb.europe-west1.firebasedatabase.app"; 
// Беремо ID з аргументу (node bots.js КОД) або за замовчуванням SMM22
const ROOM_ID = process.argv[2] || "2"; 

const delay = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms));

async function firebaseRequest(path, data, method = 'PATCH') {
    try {
        const res = await fetch(`${DB_URL}/${path}.json`, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        console.error(`❌ Помилка запису в ${path}:`, err.message);
    }
}

class MafiaBot {
    constructor(username, roomId = ROOM_ID) {
        this.username = username;
        this.roomId = roomId;
        this.heartbeatInterval = null;
    }

    // 1. Приєднання до кімнати та запуск Heartbeat
    async joinRoom() {
        console.log(`🤖 [${this.username}] Захід у кімнату ${this.roomId}...`);

        await firebaseRequest(`mafia_rooms/${this.roomId}/players/${this.username}`, {
            ready: false,
            alive: true,
            role: null,
            isDon: false,
            lastSeen: Date.now()
        }, 'PATCH');

        this.startHeartbeat();
    }

    // Оновлення lastSeen кожні 2 секунди
    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(async () => {
            await firebaseRequest(`mafia_rooms/${this.roomId}/players/${this.username}`, {
                lastSeen: Date.now()
            }, 'PATCH');
        }, 2000);
    }

    // 2. Статус готовності
    async setReady(ready = true) {
        console.log(`🤖 [${this.username}] Статус готовності -> ${ready}`);
        await firebaseRequest(`mafia_rooms/${this.roomId}/players/${this.username}`, {
            ready: ready
        }, 'PATCH');
    }

    // 3. Нічний хід
    async sendNightMove(targetUsername = null) {
        const choice = targetUsername ? "target" : "skip";
        console.log(`🤖 [${this.username}] Нічний хід: ${choice} -> ${targetUsername}`);
        await firebaseRequest(`mafia_rooms/${this.roomId}/moves/${this.username}`, {
            choice: choice,
            target: targetUsername
        }, 'PUT');
    }

    // 4. Денне голосування
    async sendDayVote(targetUsername) {
        console.log(`🤖 [${this.username}] Денний голос -> ${targetUsername}`);
        await firebaseRequest(`mafia_rooms/${this.roomId}/votes/${this.username}`, targetUsername, 'PUT');
    }

    stop() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        console.log(`🛑 [${this.username}] Бот зупинений.`);
    }
}

// Запуск 4 ботів
async function runBots() {
    const botNames = ["Bot_Alpha", "Bot_Beta", "Bot_Gamma", "Bot_Delta"];
    const bots = [];

    console.log(`🚀 Підключаємо 4 ботів до кімнати: ${ROOM_ID}`);

    // Почерговий захід у кімнату
    for (const name of botNames) {
        const bot = new MafiaBot(name);
        await bot.joinRoom();
        bots.push(bot);
        await delay(300); 
    }

    // Ставимо всім статус "Готовий"
    await delay(1000);
    for (const bot of bots) {
        await bot.setReady(true);
        await delay(200);
    }
}

runBots();