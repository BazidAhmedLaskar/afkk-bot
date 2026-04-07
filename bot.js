// bot.js – fully functional AFK mining bot
const mineflayer = require("mineflayer");
const express = require("express");

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
  version: "1.20.4",           // change to your server's version

  jumpInterval: 4000,          // jump every 4 seconds
  runInterval: 1500,           // change direction every 1.5 sec
  breakInterval: 5000,         // try to break a block every 5 sec
  breakScanRadius: 5,
  breakOnly: ["dirt", "grass_block", "grass", "stone"],
  rejoinInterval: false,       // no forced rejoin
};

let bot;
let afkIntervals = {};

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
    console.log("[bot] Bot object created, waiting for events...");
  } catch (err) {
    console.error("[bot] FATAL error:", err);
    process.exit(1);
  }

  bot.once("login", () => {
    console.log(`✅✅✅ BOT JOINED as ${bot.username} ✅✅✅`);
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

  // Random movement loop
  afkIntervals.move = setInterval(() => {
    if (!bot?.entity) return;
    // Reset all movement keys
    ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
    const dir = ["forward", "back", "left", "right"][Math.floor(Math.random() * 4)];
    bot.setControlState(dir, true);
    console.log(`[movement] moving ${dir}`);
  }, config.runInterval);

  // Block breaking loop
  afkIntervals.break = setInterval(async () => {
    if (!bot?.entity) return;
    await tryBreakBlock();
  }, config.breakInterval);

  // Optional rejoin (disabled)
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

  // Pause movement while digging
  const savedMovements = ["forward", "back", "left", "right"].filter(d => bot.getControlState(d));
  savedMovements.forEach(d => bot.setControlState(d, false));

  try {
    await bot.dig(targetBlock);
    console.log(`[break] Successfully broke ${targetBlock.name}`);
  } catch (err) {
    console.log(`[break] Failed: ${err.message}`);
  } finally {
    // Restore movement
    savedMovements.forEach(d => bot.setControlState(d, true));
  }
}

// Start the bot
createBot();