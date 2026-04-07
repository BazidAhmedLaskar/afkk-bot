// bot.js – Full AFK bot with walking, breaking, sleeping (Creative mode safe)
const mineflayer = require("mineflayer");
const express = require("express");

// ========== HEALTH SERVER FOR RENDER ==========
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot alive"));
app.get("/health", (req, res) => res.status(200).send("OK"));
app.listen(PORT, () => console.log(`[web] Health server on port ${PORT}`));
// ==============================================

const config = {
  host: "bax_10.aternos.me",
  port: 55505,
  username: "samadul_gay",
  auth: "offline",              // for cracked servers
  version: "1.20.4",            // CHANGE to your server's version (1.20.4, 1.21, etc.)

  jumpInterval: 4000,           // jump every 4 sec
  runInterval: 3000,            // change direction every 3 sec
  breakInterval: 6000,          // try to break block every 6 sec
  breakScanRadius: 4,           // max distance to look for breakable blocks
  breakOnly: ["dirt", "grass_block", "grass", "stone"], // safe blocks
  sleepCheckInterval: 60000,    // check for bed every 60 sec
  rejoinInterval: false,        // no forced rejoin
};

let bot;
let afkIntervals = {};

// ------------------- Helper: disable creative flight -------------------
async function ensureMovementWorks() {
  if (bot.game.gameMode === "creative" && bot.entity?.onGround === false) {
    console.log("[movement] Creative flight detected, disabling...");
    try {
      await bot.creative.stopFlying();
      console.log("[movement] Flight disabled, now walking");
    } catch (err) {
      console.log("[movement] Could not disable flight:", err.message);
    }
  }
}

// ------------------- Try to sleep at night -------------------
async function trySleep() {
  if (bot.isSleeping) return; // already in bed

  const time = bot.time.timeOfDay;
  const isNight = time > 13000 && time < 24000;
  if (!isNight) {
    console.log("[sleep] Not night, skipping");
    return;
  }

  const bed = bot.findBlock({
    matching: (block) => bot.isABed(block),
    maxDistance: 16,
  });

  if (!bed) {
    console.log("[sleep] No bed found within 16 blocks");
    return;
  }

  console.log("[sleep] Night time, bed found – sleeping...");
  try {
    await bot.sleep(bed);
    console.log("[sleep] Bot is sleeping");
    // Wake up automatically after 11 seconds (morning)
    setTimeout(() => {
      if (bot.isSleeping) {
        bot.wake();
        console.log("[sleep] Woke up");
      }
    }, 11000);
  } catch (err) {
    console.log(`[sleep] Failed: ${err.message}`);
  }
}

// ------------------- Try to break a block -------------------
async function tryBreakBlock() {
  const targetBlock = bot.findBlock({
    matching: (block) => {
      if (!block || block.name === "air") return false;
      return config.breakOnly.some(name => block.name.toLowerCase().includes(name));
    },
    maxDistance: config.breakScanRadius,
  });

  if (!targetBlock) return;

  const distance = bot.entity.position.distanceTo(targetBlock.position);
  console.log(`[dig] Found ${targetBlock.name} at distance ${distance.toFixed(2)}`);

  // Stop all movement and wait a moment to avoid drift
  ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
  await new Promise(resolve => setTimeout(resolve, 200));

  // Face the block
  await bot.lookAt(targetBlock.position);

  // Re-check distance (reach is ~4.5 blocks)
  const newDistance = bot.entity.position.distanceTo(targetBlock.position);
  if (newDistance > 4.5) {
    console.log(`[dig] Block out of reach after stopping (${newDistance.toFixed(2)})`);
    return;
  }

  console.log(`[dig] Breaking ${targetBlock.name}...`);
  try {
    await bot.dig(targetBlock);
    console.log(`[dig] Successfully broke ${targetBlock.name}`);
  } catch (err) {
    console.log(`[dig] Failed: ${err.message}`);
  }
}

// ------------------- AFK main loops -------------------
function startAFK() {
  // Jump
  afkIntervals.jump = setInterval(() => {
    if (!bot?.entity) return;
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 200);
  }, config.jumpInterval);

  // Random movement
  afkIntervals.move = setInterval(() => {
    if (!bot?.entity) return;
    ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
    const dir = ["forward", "back", "left", "right"][Math.floor(Math.random() * 4)];
    bot.setControlState(dir, true);
    const pos = bot.entity.position;
    console.log(`[move] ${dir} | pos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)} | onGround: ${bot.entity.onGround}`);
  }, config.runInterval);

  // Block breaking
  afkIntervals.break = setInterval(async () => {
    if (!bot?.entity) return;
    await tryBreakBlock();
  }, config.breakInterval);

  // Sleeping at night
  afkIntervals.sleep = setInterval(async () => {
    if (!bot?.entity) return;
    await trySleep();
  }, config.sleepCheckInterval);
}

// ------------------- Clean up intervals on disconnect -------------------
function clearAFKIntervals() {
  for (let key in afkIntervals) {
    clearInterval(afkIntervals[key]);
    clearTimeout(afkIntervals[key]);
  }
  afkIntervals = {};
}

// ------------------- Create and manage bot -------------------
function createBot() {
  console.log("[bot] Creating bot...");
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      version: config.version,
    });
  } catch (err) {
    console.error("[bot] FATAL error on creation:", err);
    process.exit(1);
  }

  bot.once("spawn", async () => {
    console.log(`✅ Bot spawned at ${bot.entity.position}`);
    console.log(`Gamemode: ${bot.game.gameMode}`);
    if (isNaN(bot.entity.position.x)) {
      console.error("[bot] Position NaN – wrong Minecraft version?");
      bot.quit();
      return;
    }
    await ensureMovementWorks();
    startAFK();
  });

  bot.on("end", (reason) => {
    console.log(`[bot] Disconnected: ${reason || "unknown"}`);
    clearAFKIntervals();
    setTimeout(() => createBot(), 10000); // auto-reconnect
  });

  bot.on("kicked", (reason) => console.log("[bot] Kicked:", reason));
  bot.on("error", (err) => console.log("[bot] Error event:", err));
}

// ------------------- Start everything -------------------
createBot();