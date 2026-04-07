// bot.js – Render compatible + stable AFK mining
const mineflayer = require("mineflayer");
const express = require("express");

// ========== HEALTH SERVER FOR RENDER ==========
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive"));
app.get("/health", (req, res) => res.status(200).send("OK"));
app.listen(PORT, () => console.log(`[web] Health server on port ${PORT}`));
// ==============================================

const config = {
  host: "bax_10.aternos.me",
  port: 55505,
  username: "samadul_gay",
  version: false,

  jumpInterval: 4000,
  runInterval: 1500,
  breakInterval: 5000,
  breakScanRadius: 5,
  breakOnly: ["dirt", "grass_block", "grass", "stone"],

  // Disable auto rejoin – Render will restart if needed
  // Set to a very high value (or remove the timeout entirely)
  rejoinInterval: false, // or 300000 (5 minutes) if you really want it
};

let bot;
let afkIntervals = {};

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
  });

  bot.on("login", () => {
    console.log(`[bot] Logged in as ${bot.username} on ${config.host}:${config.port}`);
    startAFK();
  });

  bot.on("end", (reason) => {
    console.log(`[bot] Disconnected: ${reason || "unknown"}`);
    clearAFKIntervals();
    // Optionally auto‑reconnect after a delay
    setTimeout(() => {
      console.log("[bot] Attempting to reconnect...");
      createBot();
    }, 10000);
  });

  bot.on("kicked", (reason) => console.log("[bot] Kicked:", reason));
  bot.on("error", (err) => console.log("[bot] Error:", err));
}

function clearAFKIntervals() {
  for (let key in afkIntervals) {
    clearInterval(afkIntervals[key]);
    clearTimeout(afkIntervals[key]);
  }
  afkIntervals = {};
}

function startAFK() {
  afkIntervals.jump = setInterval(() => {
    if (!bot?.entity) return;
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 200);
  }, config.jumpInterval);

  afkIntervals.move = setInterval(() => {
    if (!bot?.entity) return;
    ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
    const dir = ["forward", "back", "left", "right"][Math.floor(Math.random() * 4)];
    bot.setControlState(dir, true);
    console.log(`[movement] moving ${dir}`);
  }, config.runInterval);

  afkIntervals.break = setInterval(async () => {
    if (!bot?.entity) return;
    await tryBreakBlock();
  }, config.breakInterval);

  // Optional rejoin – only if rejoinInterval is a positive number
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