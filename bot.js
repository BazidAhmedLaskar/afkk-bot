// bot.js – Netherite mining bot with keep-alive and reconnection fixes
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const express = require("express");

// ========== HEALTH SERVER ==========
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot alive"));
app.get("/health", (req, res) => res.status(200).send("OK"));
app.listen(PORT, () => console.log(`[web] Health server on port ${PORT}`));

// ========== CONFIGURATION ==========
const config = {
  host: "bax_10.aternos.me",
  port: 55505,
  username: "sidli_porn",
  auth: "offline",
            // CHANGE THIS to your server's version (e.g., "1.19.2", "1.20.4")

  diamondLevelY: -59,
  stopWhenFull: true,
  messageInterval: 5,
  valuableOres: ["coal_ore", "iron_ore", "diamond_ore"],

  autoGiveDiamonds: true,
  autoStoreInChest: false,
  chestPosition: { x: 0, y: 64, z: 0 },
  returnToMineAfterChest: true,

  sleepCheckInterval: 60000,
  moveForwardTime: 800,
  miningIntervalMs: 2500,      // increased from 2000 to reduce server load
  reconnectDelayMs: 5000,      // initial reconnection delay
  keepAliveTimeout: 30000,     // increase keep-alive timeout
};

let bot;
let afkIntervals = {};
let reconnectAttempts = 0;
let valuableOreCount = 0;
let oresSinceLastMsg = 0;
let diamondCount = 0;
let currentPhase = "descending";
let miningOrigin = null;

function sendMessage(msg) {
  if (bot && bot.chat) bot.chat(msg);
  console.log(`[chat] -> ${msg}`);
}

// ========== INVENTORY HELPERS ==========
function countDiamondsInInventory() {
  if (!bot || !bot.inventory) return 0;
  let count = 0;
  for (const item of bot.inventory.items()) {
    if (item.name === "diamond") count += item.count;
  }
  return count;
}

function isInventoryFull() {
  if (!bot || !bot.inventory) return false;
  const emptySlots = bot.inventory.slots.filter(s => s === null).length;
  return emptySlots < 5;
}

// ========== BLOCK HELPERS ==========
function isFallingBlock(block) {
  return block && (block.name === "gravel" || block.name === "sand" || block.name === "red_sand");
}

function isUnbreakable(block) {
  if (!block) return true;
  return ["bedrock", "lava", "water", "air"].includes(block.name);
}

function isSolid(block) {
  return block && block.boundingBox === "block" && block.name !== "air";
}

function isValuableOre(block) {
  return block && config.valuableOres.includes(block.name);
}

// ========== CORE MINING ==========
async function breakBlock(block) {
  if (!block || isUnbreakable(block)) return false;
  
  ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
  await new Promise(r => setTimeout(r, 50));
  await bot.lookAt(block.position);
  
  const isFalling = isFallingBlock(block);
  try {
    await bot.dig(block);
    console.log(`[mine] Broke ${block.name}`);
    
    if (isValuableOre(block)) {
      valuableOreCount++;
      oresSinceLastMsg++;
      if (oresSinceLastMsg >= config.messageInterval) {
        sendMessage(`⛏️ Mined ${valuableOreCount} valuable ores so far`);
        oresSinceLastMsg = 0;
      }
      if (block.name === "diamond_ore") {
        sendMessage(`💎 Diamond ore found!`);
      }
    }
    
    if (isFalling) {
      bot.setControlState("back", true);
      await new Promise(r => setTimeout(r, 300));
      bot.setControlState("back", false);
    }
    return true;
  } catch (err) {
    console.log(`[mine] Failed: ${err.message}`);
    return false;
  }
}

async function moveForward() {
  if (!bot || !bot.entity) return;
  const pos = bot.entity.position;
  const frontFeet = bot.blockAt(pos.offset(0, 0, 1));
  const frontHead = bot.blockAt(pos.offset(0, 1, 1));
  if (isSolid(frontFeet) || isSolid(frontHead)) return;
  
  bot.setControlState("forward", true);
  await new Promise(r => setTimeout(r, config.moveForwardTime));
  bot.setControlState("forward", false);
}

// ========== DIAMOND HANDLING ==========
async function giveDiamondsToNearestPlayer() {
  if (!bot || !bot.players) return false;
  const players = Object.values(bot.players).filter(p => p.entity && p.username !== bot.username);
  if (players.length === 0) return false;
  let closest = null, closestDist = 10;
  for (const p of players) {
    const dist = bot.entity.position.distanceTo(p.entity.position);
    if (dist < closestDist) { closestDist = dist; closest = p; }
  }
  if (!closest) return false;
  const diamonds = bot.inventory.items().filter(i => i.name === "diamond");
  if (diamonds.length === 0) return false;
  const total = diamonds.reduce((s,i)=>s+i.count,0);
  sendMessage(`🎁 Giving ${total} diamonds to ${closest.username}`);
  for (const item of diamonds) await bot.toss(item.type, null, item.count);
  return true;
}

async function storeDiamondsInChest() {
  if (!config.chestPosition) return false;
  const chestBlock = bot.blockAt(config.chestPosition);
  if (!chestBlock || !bot.isChest(chestBlock)) return false;
  sendMessage(`Going to chest...`);
  await bot.pathfinder.goto(new goals.GoalBlock(config.chestPosition.x, config.chestPosition.y, config.chestPosition.z));
  const chest = await bot.openChest(chestBlock);
  const diamonds = bot.inventory.items().filter(i => i.name === "diamond");
  for (const item of diamonds) await chest.deposit(item.type, null, item.count);
  sendMessage(`Deposited ${diamonds.reduce((s,i)=>s+i.count,0)} diamonds`);
  await chest.close();
  return true;
}

// ========== DESCENT (staircase) ==========
async function descendStep() {
  if (currentPhase !== "descending") return;
  if (!bot || bot.isSleeping) return;
  if (bot.entity.position.y <= config.diamondLevelY) {
    sendMessage(`✅ Reached diamond level. Starting strip mining.`);
    currentPhase = "stripMining";
    miningOrigin = bot.entity.position.floored();
    return;
  }
  const pos = bot.entity.position;
  const feet = bot.blockAt(pos.offset(0,0,1));
  const head = bot.blockAt(pos.offset(0,1,1));
  const below = bot.blockAt(pos.offset(0,-1,1));
  if (isSolid(feet)) await breakBlock(feet);
  if (isSolid(head)) await breakBlock(head);
  if (isSolid(below)) await breakBlock(below);
  bot.setControlState("forward", true);
  await new Promise(r => setTimeout(r, 500));
  bot.setControlState("forward", false);
  const newFeet = bot.blockAt(bot.entity.position.offset(0,0,1));
  if (newFeet && newFeet.name === "air") {
    bot.setControlState("sneak", true);
    bot.setControlState("forward", true);
    await new Promise(r => setTimeout(r, 400));
    bot.setControlState("forward", false);
    bot.setControlState("sneak", false);
  }
}

// ========== STRIP MINING ==========
async function stripMineStep() {
  if (currentPhase !== "stripMining") return;
  if (!bot || bot.isSleeping) return;
  if (bot.entity.position.y > config.diamondLevelY + 2) {
    currentPhase = "descending";
    return;
  }
  if (config.stopWhenFull && isInventoryFull()) {
    sendMessage("Inventory full, stopping mining.");
    currentPhase = "idle";
    return;
  }
  
  const currentDiamonds = countDiamondsInInventory();
  if (currentDiamonds > diamondCount) {
    const gained = currentDiamonds - diamondCount;
    diamondCount = currentDiamonds;
    sendMessage(`💎 Now carrying ${diamondCount} diamonds`);
    if (config.autoGiveDiamonds) {
      if (await giveDiamondsToNearestPlayer()) diamondCount = countDiamondsInInventory();
    }
    if (!config.autoGiveDiamonds && config.autoStoreInChest && diamondCount >= 5) {
      currentPhase = "returningToChest";
      return;
    }
  }
  
  const pos = bot.entity.position;
  const feetBlock = bot.blockAt(pos.offset(0,0,1));
  const headBlock = bot.blockAt(pos.offset(0,1,1));
  const passable = (b) => !b || b.name === "air" || b.boundingBox !== "block";
  
  if (passable(feetBlock) && passable(headBlock)) {
    await moveForward();
    return;
  }
  
  if (headBlock && !passable(headBlock)) await breakBlock(headBlock);
  if (feetBlock && !passable(feetBlock)) await breakBlock(feetBlock);
  await moveForward();
}

// ========== CHEST RETURN ==========
async function returnToChestAndBack() {
  if (currentPhase !== "returningToChest") return;
  if (await storeDiamondsInChest()) {
    diamondCount = 0;
    if (config.returnToMineAfterChest && miningOrigin) {
      await bot.pathfinder.goto(new goals.GoalBlock(miningOrigin.x, miningOrigin.y, miningOrigin.z));
    }
  }
  currentPhase = "stripMining";
}

// ========== SLEEP ==========
async function trySleep() {
  if (!bot || bot.isSleeping) return;
  const time = bot.time.timeOfDay;
  if (time < 13000 || time > 24000) return;
  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 });
  if (!bed) return;
  sendMessage("Night time, sleeping...");
  try {
    await bot.sleep(bed);
    setTimeout(() => { if (bot && bot.isSleeping) bot.wake(); }, 11000);
  } catch (err) { console.log(`Sleep failed: ${err.message}`); }
}

// ========== CHAT COMMANDS ==========
function setupChatCommands() {
  bot.on("chat", async (username, message) => {
    if (username === bot.username) return;
    const cmd = message.toLowerCase();
    if (cmd === "!start") { currentPhase = "stripMining"; sendMessage("Resumed mining"); }
    else if (cmd === "!stop") { currentPhase = "idle"; sendMessage("Paused"); }
    else if (cmd === "!status") { sendMessage(`Phase: ${currentPhase} | Ores mined: ${valuableOreCount} | Diamonds: ${diamondCount}`); }
    else if (cmd === "!descend") { currentPhase = "descending"; sendMessage("Descending"); }
    else if (cmd === "!diamonds") { if (await giveDiamondsToNearestPlayer()) diamondCount = countDiamondsInInventory(); else sendMessage("No diamonds or player nearby"); }
    else if (cmd === "!chest") { currentPhase = "returningToChest"; }
  });
}

// ========== KEEP-ALIVE HANDLER ==========
function handleKeepAlive() {
  // mineflayer already handles keep-alive by default, but we can increase timeouts
  if (bot._client && bot._client.keepAlive) {
    // Increase the keep-alive timeout to 30 seconds
    bot._client.keepAlive.timeout = config.keepAliveTimeout;
  }
}

// ========== LOOPS ==========
function startBehaviors() {
  if (afkIntervals.mine) clearInterval(afkIntervals.mine);
  afkIntervals.mine = setInterval(async () => {
    if (!bot?.entity || bot.isSleeping) return;
    if (currentPhase === "descending") await descendStep();
    else if (currentPhase === "stripMining") await stripMineStep();
    else if (currentPhase === "returningToChest") await returnToChestAndBack();
  }, config.miningIntervalMs);
  
  if (afkIntervals.sleep) clearInterval(afkIntervals.sleep);
  afkIntervals.sleep = setInterval(async () => { if (bot?.entity) await trySleep(); }, config.sleepCheckInterval);
}

function clearIntervals() {
  for (let key in afkIntervals) {
    if (afkIntervals[key]) clearInterval(afkIntervals[key]);
  }
  afkIntervals = {};
}

// ========== RECONNECT WITH BACKOFF ==========
function reconnect() {
  const delay = Math.min(30000, config.reconnectDelayMs * Math.pow(1.5, reconnectAttempts));
  reconnectAttempts++;
  console.log(`Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts})...`);
  setTimeout(() => createBot(), delay);
}

// ========== BOT CREATION ==========
function createBot() {
  if (bot) {
    clearIntervals();
    bot.end();
  }
  
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version,
    keepAlive: true,
    checkTimeoutInterval: config.keepAliveTimeout,
  });
  
  bot.loadPlugin(pathfinder);
  
  bot.once("spawn", () => {
    reconnectAttempts = 0; // reset on successful connection
    const mcData = require("minecraft-data")(bot.version);
    const moves = new Movements(bot, mcData);
    moves.allowParkour = false;
    moves.canDig = false;
    bot.pathfinder.setMovements(moves);
    console.log(`✅ Bot ready at ${bot.entity.position}`);
    sendMessage("Netherite mining bot online – mining only coal, iron, diamond ores. Commands: !start, !stop, !status, !descend, !diamonds, !chest");
    setupChatCommands();
    startBehaviors();
    handleKeepAlive();
    currentPhase = "descending";
  });
  
  bot.on("end", (reason) => {
    console.log(`Disconnected: ${reason}`);
    clearIntervals();
    reconnect();
  });
  
  bot.on("kicked", (reason) => {
    console.log("Kicked:", JSON.stringify(reason, null, 2));
    clearIntervals();
    reconnect();
  });
  
  bot.on("error", (err) => {
    console.log("Error:", err);
    // Don't reconnect immediately on error, let 'end' handle it
  });
}

// Start the bot
createBot();
