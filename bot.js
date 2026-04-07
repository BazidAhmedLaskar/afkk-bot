// bot.js – guaranteed walking + creative flight fix
const mineflayer = require("mineflayer");
const express = require("express");
const Vec3 = require("vec3");

// ========== HEALTH SERVER ==========
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot alive"));
app.get("/health", (req, res) => res.status(200).send("OK"));
app.listen(PORT, () => console.log(`[web] Health server on port ${PORT}`));
// ===================================

const config = {
  host: "bax_10.aternos.me",
  port: 55505,
  username: "samadul_gay",
  auth: "offline",
 

  jumpInterval: 4000,
  runInterval: 3000,            // increased to 3 sec per direction
  breakInterval: 5000,
  breakScanRadius: 5,
  breakOnly: ["dirt", "grass_block", "grass", "stone"],
  rejoinInterval: false,
};

let bot;
let afkIntervals = {};

async function ensureMovementWorks() {
  // If bot is in creative mode and flying, disable flight
  if (bot.game.gameMode === "creative" && bot.entity?.onGround === false) {
    console.log("[movement] Creative flight detected, disabling...");
    try {
      await bot.creative.stopFlying();
      console.log("[movement] Flight disabled, now on ground");
    } catch (err) {
      console.log("[movement] Could not disable flight:", err.message);
    }
  }
}

function createBot() {
  console.log("[bot] Attempting to create bot...");
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      version: config.version,
    });
  } catch (err) {
    console.error("[bot] FATAL error:", err);
    process.exit(1);
  }

  bot.once("login", async () => {
    console.log(`✅✅✅ BOT JOINED as ${bot.username} ✅✅✅`);
    // Wait a bit for the world to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    await ensureMovementWorks();
    startAFK();
  });

  bot.on("end", (reason) => {
    console.log(`[bot] Disconnected: ${reason || "unknown"}`);
    clearAFKIntervals();
    setTimeout(() => createBot(), 10000);
  });

  bot.on("kicked", (reason) => console.log("[bot] Kicked:", reason));
  bot.on("error", (err) => console.log("[bot] Error event:", err));
}

function clearAFKIntervals() {
  for (let key in afkIntervals) {
    clearInterval(afkIntervals[key]);
    clearTimeout(afkIntervals[key]);
  }
  afkIntervals = {};
}

function startAFK() {
  // Jump loop
  afkIntervals.jump = setInterval(() => {
    if (!bot?.entity) return;
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 200);
  }, config.jumpInterval);

  // Random movement loop (with debug)
  afkIntervals.move = setInterval(() => {
    if (!bot?.entity) return;
    
    // Reset all movement
    ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
    
    // Choose random direction
    const dir = ["forward", "back", "left", "right"][Math.floor(Math.random() * 4)];
    bot.setControlState(dir, true);
    
    // Log position and direction to confirm movement
    const pos = bot.entity.position;
    console.log(`[movement] ${dir} | pos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)} | onGround: ${bot.entity.onGround}`);
  }, config.runInterval);

  // Block breaking loop (unchanged)
  afkIntervals.break = setInterval(async () => {
    if (!bot?.entity) return;
    await tryBreakBlock();
  }, config.breakInterval);

  if (config.rejoinInterval && config.rejoinInterval > 0) {
    afkIntervals.rejoin = setTimeout(() => {
      console.log("[rejoin] Forcing rejoin...");
      clearAFKIntervals();
      bot.quit();
    }, config.rejoinInterval);
  }
}

async function tryBreakBlock() {
  const targetBlock = bot.findBlock({
    matching: (block) => {
      if (!block || block.name === "air") return false;
      return config.breakOnly.some(name => block.name.toLowerCase().includes(name));
    },
    maxDistance: config.breakScanRadius,
  });

  if (!targetBlock) {
    const nearby = bot.findBlocks({
      matching: (b) => b && b.name !== "air",
      maxDistance: 6,
      count: 5,
    });
    if (nearby.length) {
      const names = nearby.map(pos => bot.blockAt(pos)?.name).filter(Boolean);
      console.log(`[break] No breakable block within ${config.breakScanRadius}. Nearby: ${names.join(", ")}`);
    }
    return;
  }

  const distance = bot.entity.position.distanceTo(targetBlock.position);
  console.log(`[break] Found ${targetBlock.name} at distance ${distance.toFixed(2)}. Breaking...`);

  const savedMovements = ["forward", "back", "left", "right"].filter(d => bot.getControlState(d));
  savedMovements.forEach(d => bot.setControlState(d, false));

  try {
    await bot.dig(targetBlock);
    console.log(`[break] Successfully broke ${targetBlock.name}`);
  } catch (err) {
    console.log(`[break] Failed: ${err.message}`);
  } finally {
    savedMovements.forEach(d => bot.setControlState(d, true));
  }
}

createBot();