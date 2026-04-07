// bot.js
const mineflayer = require("mineflayer");

// =================== CONFIG ===================
const config = {
  host: "bax_10.aternos.me",
  port: 55505,
  username: "samadul_gay", // change name if duplicate login happens
  version: false, // auto-detect version

  jumpInterval: 3000, // jump every 4s
  runInterval: 1000, // change random direction every 2s
  breakInterval: 6000, // attempt block break every 6s
  breakScanRadius: 4, // max block search distance
  breakOnly: ["dirt", "grass_block", "stone"], // safe blocks

  rejoinInterval: 300000, // leave + rejoin every 30s
};
// ===============================================

let bot;

function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
  });

  bot.on("login", () => {
    console.log(
      `[bot] spawned as ${bot.username} on ${config.host}:${config.port}`
    );
    console.log(`[bot] AFK behaviors started`);
    startAFK();
  });

  bot.on("end", () => {
    console.log("[bot] disconnected, waiting to rejoin...");
  });

  bot.on("kicked", (reason) => console.log("[bot] kicked:", reason));
  bot.on("error", (err) => console.log("[bot] error:", err));
}

// Main AFK loop
function startAFK() {
  // Jump loop
  const jumpLoop = setInterval(() => {
    if (!bot || !bot.entity) return;
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 200);
  }, config.jumpInterval);

  // Random movement
  const moveLoop = setInterval(() => {
    if (!bot || !bot.entity) return;
    const directions = ["forward", "back", "left", "right"];
    directions.forEach((d) => bot.setControlState(d, false)); // reset
    const dir = directions[Math.floor(Math.random() * directions.length)];
    bot.setControlState(dir, true);
  }, config.runInterval);

  // Block breaking loop
  const breakLoop = setInterval(() => {
    if (!bot || !bot.entity) return;
    tryBreakBlock();
  }, config.breakInterval);

  // Leave + rejoin cycle
  setTimeout(() => {
    console.log("[bot] Leaving server to rejoin...");
    clearInterval(jumpLoop);
    clearInterval(moveLoop);
    clearInterval(breakLoop);
    bot.quit();
    setTimeout(() => {
      console.log("[bot] Rejoining server...");
      createBot();
    }, 2000); // wait 2s before reconnect
  }, config.rejoinInterval);
}

// Block breaking function
function tryBreakBlock() {
  const block = bot.findBlock({
    matching: (b) => {
      if (!b || !b.position) return false;
      if (b.type === 0) return false; // air
      if (!config.breakOnly.includes(b.name)) return false;
      const dist = bot.entity.position.distanceTo(b.position);
      return dist <= config.breakScanRadius;
    },
    maxDistance: config.breakScanRadius,
  });

  if (!block) {
    console.log("[bot] no block found nearby to break");
    return;
  }

  console.log(`[bot] breaking block: ${block.name} at ${block.position}`);
  bot.dig(block).catch((err) => console.log("[bot] dig error:", err.message));
}

// Start first bot
createBot();
