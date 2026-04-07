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
  host: "bax_10.aternos.me",
  port: 55505,
  username: "samadul_gay",
  auth: "offline",

  // Strip mining settings
  stripMining: true,               // start strip mining on login
  blocksToMine: ["stone", "deepslate", "dirt", "coal_ore", "iron_ore", "cobblestone"],
  stopWhenFull: true,              // stop if inventory full
  messageInterval: 10,             // announce every 10 blocks mined
  mineStepInterval: 2000,          // mine one step every 2 seconds
  moveForwardTime: 800,            // ms to hold forward after clearing
};

let bot;
let afkIntervals = {};
let stripMiningActive = true;
let blocksMinedTotal = 0;
let blocksMinedSinceLastMsg = 0;

// ------------------- Helper: send chat message -------------------
function sendMessage(msg) {
  bot.chat(msg);
  console.log(`[chat] -> ${msg}`);
}

// ------------------- Inventory check -------------------
function isInventoryFull() {
  const slots = bot.inventory.slots;
  const emptySlots = slots.filter(s => s === null).length;
  return emptySlots < 5; // less than 5 free slots = full
}

// ------------------- Break a single block -------------------
async function breakBlock(block) {
  // Stop movement
  ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
  await new Promise(resolve => setTimeout(resolve, 100));

  // Face the block
  await bot.lookAt(block.position);

  // Dig
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
  if (!stripMiningActive) return;
  if (!bot.entity) return;

  // Stop if inventory full
  if (config.stopWhenFull && isInventoryFull()) {
    sendMessage("Inventory full, stopping mining");
    stripMiningActive = false;
    return;
  }

  const pos = bot.entity.position;
  // Blocks directly ahead: at feet (y) and at head (y+1)
  const floorBlock = bot.blockAt(pos.offset(0, 0, 1));
  const headBlock = bot.blockAt(pos.offset(0, 1, 1));

  const blocksToBreak = [];
  if (floorBlock && config.blocksToMine.includes(floorBlock.name)) blocksToBreak.push(floorBlock);
  if (headBlock && config.blocksToMine.includes(headBlock.name)) blocksToBreak.push(headBlock);

  if (blocksToBreak.length === 0) {
    // No mineable blocks ahead – just move forward
    await moveForward();
    return;
  }

  // Break blocks (head first to avoid falling blocks)
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

  // Move forward into the cleared space
  await moveForward();
}

// ------------------- Chat command handler -------------------
function setupChatCommands() {
  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    const cmd = message.toLowerCase();
    if (cmd === "!start") {
      stripMiningActive = true;
      sendMessage("Strip mining resumed");
    } else if (cmd === "!stop") {
      stripMiningActive = false;
      sendMessage("Strip mining paused");
    } else if (cmd === "!status") {
      sendMessage(`Mined ${blocksMinedTotal} blocks | Mining: ${stripMiningActive}`);
    }
  });
}

// ------------------- Main AFK loops (no sleep) -------------------
function startBehaviors() {
  // Strip mining loop
  afkIntervals.mine = setInterval(async () => {
    if (!bot?.entity) return;
    await stripMineStep();
  }, config.mineStepInterval);

  // Optional: small jump every now and then (but not while mining to avoid interruption)
  // If you want occasional jumping even while mining, you can add it here, but it may disrupt.
  // For now, no jumping to keep mining smooth.
}

function clearIntervals() {
  for (let key in afkIntervals) {
    clearInterval(afkIntervals[key]);
    clearTimeout(afkIntervals[key]);
  }
  afkIntervals = {};
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
      version: config.version,
    });
  } catch (err) {
    console.error("[bot] FATAL error:", err);
    process.exit(1);
  }

  bot.once("spawn", () => {
    console.log(`✅ Bot spawned at ${bot.entity.position}`);
    sendMessage("Strip mining bot active! Commands: !start, !stop, !status");
    setupChatCommands();
    startBehaviors();
  });

  bot.on("end", (reason) => {
    console.log(`[bot] Disconnected: ${reason || "unknown"}`);
    clearIntervals();
    setTimeout(() => createBot(), 10000);
  });

  bot.on("kicked", (reason) => console.log("[bot] Kicked:", reason));
  bot.on("error", (err) => console.log("[bot] Error event:", err));
}

createBot();