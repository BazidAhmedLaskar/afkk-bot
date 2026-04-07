// bot.js (fixed & debugged)
const mineflayer = require("mineflayer");

const config = {
  host: "bax_10.aternos.me",
  port: 55505,
  username: "samadul_gay",
  version: false,

  jumpInterval: 4000,
  runInterval: 1500,
  breakInterval: 5000,
  breakScanRadius: 5,           // increased from 4
  breakOnly: ["dirt", "grass_block", "grass", "stone"], // added "grass" fallback

  rejoinInterval: 30000,        // 30 seconds – maybe increase to 60s?
};

let bot;
let afkIntervals = {};          // store intervals to clear properly

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
  });

  bot.on("kicked", (reason) => console.log("[bot] Kicked:", reason));
  bot.on("error", (err) => console.log("[bot] Error:", err));
}

function clearAFKIntervals() {
  for (let key in afkIntervals) {
    clearInterval(afkIntervals[key]);
    clearTimeout(afkIntervals[key]); // in case any timeouts stored
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
    // Reset all movement
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

  // Rejoin timeout
  afkIntervals.rejoin = setTimeout(() => {
    console.log("[rejoin] Leaving server to force rejoin...");
    clearAFKIntervals();
    bot.quit();
    setTimeout(() => {
      console.log("[rejoin] Recreating bot...");
      createBot();
    }, 3000);
  }, config.rejoinInterval);
}

async function tryBreakBlock() {
  // 1. Find a block matching our whitelist
  const targetBlock = bot.findBlock({
    matching: (block) => {
      if (!block || block.name === "air") return false;
      // Check against allowed names (case-insensitive just in case)
      return config.breakOnly.some(name => block.name.toLowerCase().includes(name));
    },
    maxDistance: config.breakScanRadius,
  });

  if (!targetBlock) {
    // Extra debug: list nearby blocks within 6 blocks
    const nearby = bot.findBlocks({
      matching: (b) => b && b.name !== "air",
      maxDistance: 6,
      count: 5,
    });
    if (nearby.length) {
      const names = nearby.map(pos => bot.blockAt(pos)?.name).filter(Boolean);
      console.log(`[break] No breakable block within ${config.breakScanRadius}. Nearby blocks: ${names.join(", ")}`);
    } else {
      console.log(`[break] No blocks at all within 6 blocks – maybe void or unloaded chunk?`);
    }
    return;
  }

  const distance = bot.entity.position.distanceTo(targetBlock.position);
  console.log(`[break] Found ${targetBlock.name} at distance ${distance.toFixed(2)}. Attempting to break...`);

  // 2. Pause movement while digging to avoid interruption
  const savedMovements = ["forward", "back", "left", "right"].filter(d => bot.getControlState(d));
  savedMovements.forEach(d => bot.setControlState(d, false));

  // 3. Dig with error handling
  try {
    await bot.dig(targetBlock);
    console.log(`[break] Successfully broke ${targetBlock.name}`);
  } catch (err) {
    console.log(`[break] Failed to break ${targetBlock.name}: ${err.message}`);
  } finally {
    // Restore movement after digging (or after failure)
    savedMovements.forEach(d => bot.setControlState(d, true));
  }
}

// Start the bot
createBot();