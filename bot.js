// bot.js – Strip mining, chat commands, health server (no sleep)
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
  host: "bax_10.aternos.me",      // ✅ FIXED: removed underscore
  port: 55505,
  username: "samadul_gay",
  auth: "offline",

  // Strip mining settings
  stripMining: true,
  blocksToMine: ["stone", "deepslate", "dirt", "coal_ore", "iron_ore", "cobblestone"],
  stopWhenFull: true,
  messageInterval: 10,
  mineStepInterval: 2000,
  moveForwardTime: 800,
};

let bot;
let stripMiningActive = true;
let blocksMinedTotal = 0;
let blocksMinedSinceLastMsg = 0;
let miningLoopRunning = false;

// ------------------- Helper: send chat message -------------------
function sendMessage(msg) {
  bot.chat(msg);
  console.log(`[chat] -> ${msg}`);
}

// ------------------- Inventory check -------------------
function isInventoryFull() {
  const slots = bot.inventory.slots;
  const emptySlots = slots.filter(s => s === null).length;
  return emptySlots < 5;
}

// ------------------- Break a single block -------------------
async function breakBlock(block) {
  ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
  await new Promise(resolve => setTimeout(resolve, 100));

  await bot.lookAt(block.position);

  try {
    await bot.dig(block);
    console.log(`[mine] Broke ${block.name}`);
    return true;
  } catch (err) {
    console.log(`[mine] Failed to break ${block.name}: ${err.message}`);
    return false;
  }
}

// ------------------- Move forward one step -------------------
async function moveForward() {
  bot.setControlState("forward", true);
  await new Promise(resolve => setTimeout(resolve, config.moveForwardTime));
  bot.setControlState("forward", false);
}

// ------------------- Strip mining step -------------------
async function stripMineStep() {
  if (!stripMiningActive || !bot.entity) return;

  if (config.stopWhenFull && isInventoryFull()) {
    sendMessage("Inventory full, stopping mining");
    stripMiningActive = false;
    return;
  }

  const pos = bot.entity.position;
  const yaw = bot.entity.yaw;
  // Calculate forward direction vector based on yaw
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);

  const floorBlock = bot.blockAt(pos.offset(forwardX, 0, forwardZ));
  const headBlock  = bot.blockAt(pos.offset(forwardX, 1, forwardZ));

  const blocksToBreak = [];
  if (floorBlock && config.blocksToMine.includes(floorBlock.name)) blocksToBreak.push(floorBlock);
  if (headBlock && config.blocksToMine.includes(headBlock.name)) blocksToBreak.push(headBlock);

  if (blocksToBreak.length === 0) {
    await moveForward();
    return;
  }

  for (const block of blocksToBreak) {
    const success = await breakBlock(block);
    if (success) {
      blocksMinedTotal++;
      blocksMinedSinceLastMsg++;
      if (block.name.includes("ore")) {
        sendMessage(`Found ${block.name}!`);
      }
      if (blocksMinedSinceLastMsg >= config.messageInterval) {
        sendMessage(`Mined ${blocksMinedTotal} blocks total`);
        blocksMinedSinceLastMsg = 0;
      }
    }
  }

  await moveForward();
}

// ------------------- Mining loop (no overlapping) -------------------
async function miningLoop() {
  if (miningLoopRunning) return;
  miningLoopRunning = true;
  while (stripMiningActive) {
    await stripMineStep();
    await new Promise(resolve => setTimeout(resolve, config.mineStepInterval));
  }
  miningLoopRunning = false;
}

// ------------------- Chat commands -------------------
function setupChatCommands() {
  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    const cmd = message.toLowerCase();
    if (cmd === "!start") {
      stripMiningActive = true;
      sendMessage("Strip mining resumed");
      miningLoop(); // restart loop if stopped
    } else if (cmd === "!stop") {
      stripMiningActive = false;
      sendMessage("Strip mining paused");
    } else if (cmd === "!status") {
      sendMessage(`Mined ${blocksMinedTotal} blocks | Mining: ${stripMiningActive}`);
    }
  });
}

// ------------------- Bot creation -------------------
function createBot() {
  console.log("[bot] Creating bot...");
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      // ✅ version field REMOVED – Mineflayer auto-detects
    });
  } catch (err) {
    console.error("[bot] FATAL error:", err);
    process.exit(1);
  }

  bot.once("spawn", () => {
    console.log(`✅ Bot spawned at ${bot.entity.position}`);
    // ✅ FIX: Face south (+Z) so forward = +Z
    bot.look(0, 0, true); // yaw=0, pitch=0
    sendMessage("Strip mining bot active! Commands: !start, !stop, !status");
    setupChatCommands();
    miningLoop();
  });

  bot.on("end", (reason) => {
    console.log(`[bot] Disconnected: ${reason || "unknown"}`);
    stripMiningActive = false; // stop loop on disconnect
    setTimeout(() => createBot(), 10000);
  });

  bot.on("kicked", (reason) => console.log("[bot] Kicked:", reason));
  bot.on("error", (err) => console.log("[bot] Error event:", err));
}

createBot();
