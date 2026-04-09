// bot.js – Netherite mining bot with auto direction change on stubborn blocks
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
  username: "samadul_gay",
  auth: "offline",

  diamondLevelY: -59,
  stopWhenFull: true,
  messageInterval: 5,

  valuableOres: ["coal_ore", "iron_ore", "diamond_ore", "deepslate_diamond_ore", "redstone_ore", "deepslate_redstone_ore"],

  autoGiveDiamonds: true,
  autoStoreInChest: false,
  chestPosition: { x: 0, y: 64, z: 0 },
  returnToMineAfterChest: true,

  sleepCheckInterval: 60000,
  moveForwardTime: 800,
  stuckTimeout: 5000,
  directionChangeCooldown: 10000,
};

let bot;
let afkIntervals = {};
let valuableOreCount = 0;
let oresSinceLastMsg = 0;
let diamondCount = 0;

let currentPhase = "descending";
let miningOrigin = null;

let lastPosition = null;
let lastMoveTime = Date.now();
let lastDirectionChange = 0;

// Temporary blacklist for blocks that fail (cleared after direction change)
let tempFailedBlocks = new Set();

function sendMessage(msg) {
  bot.chat(msg);
  console.log(`[chat] -> ${msg}`);
}

// ========== INVENTORY HELPERS ==========
function countDiamondsInInventory() {
  let count = 0;
  for (const item of bot.inventory.items()) {
    if (item.name === "diamond") count += item.count;
  }
  return count;
}

function isInventoryFull() {
  const emptySlots = bot.inventory.slots.filter((s) => s === null).length;
  return emptySlots < 5;
}

// ========== PICKAXE MANAGEMENT ==========
const PICKAXE_TIERS = ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe"];
const TIER_LEVEL = {
  wooden_pickaxe: 1,
  stone_pickaxe: 2,
  iron_pickaxe: 3,
  diamond_pickaxe: 4,
  netherite_pickaxe: 5
};

function getBestPickaxe() {
  let best = null;
  let bestLevel = 0;
  for (const item of bot.inventory.items()) {
    const itemName = item.name.replace("minecraft:", "");
    if (PICKAXE_TIERS.includes(itemName)) {
      const level = TIER_LEVEL[itemName];
      if (level > bestLevel) {
        bestLevel = level;
        best = item;
      }
    }
  }
  if (best) console.log(`[pickaxe] Best available: ${best.name} (tier ${bestLevel})`);
  else console.log(`[pickaxe] No pickaxe found!`);
  return best;
}

async function equipBestPickaxe() {
  const pick = getBestPickaxe();
  if (!pick) return false;
  
  if (bot.heldItem && bot.heldItem.type === pick.type) {
    console.log(`[equip] Already holding ${pick.name}`);
    return true;
  }
  
  try {
    await bot.equip(pick, "hand");
    console.log(`[equip] Equipped ${pick.name}`);
    return true;
  } catch (err) {
    console.log(`[equip] Failed to equip ${pick.name}: ${err.message}`);
    return false;
  }
}

function hasIronPickaxeOrBetter() {
  const pick = getBestPickaxe();
  if (!pick) return false;
  const tier = TIER_LEVEL[pick.name.replace("minecraft:", "")];
  return tier >= 3;
}

// ========== BLOCK HELPERS ==========
function isFallingBlock(block) {
  return block && ["gravel", "sand", "red_sand"].includes(block.name);
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

// ========== CORE MINING WITH AUTO DIRECTION CHANGE ==========
async function breakBlock(block, retry = true) {
  if (!block || isUnbreakable(block)) return false;

  const blockKey = `${block.position.x},${block.position.y},${block.position.z}`;
  if (tempFailedBlocks.has(blockKey)) {
    console.log(`[mine] Temporarily skipping problematic block ${block.name} at ${blockKey}`);
    return false;
  }

  // Stop all movement and pathfinder
  ["forward", "back", "left", "right", "jump"].forEach(d => bot.setControlState(d, false));
  if (bot.pathfinder) bot.pathfinder.stop();
  await new Promise(r => setTimeout(r, 150));

  await bot.lookAt(block.position);
  await new Promise(r => setTimeout(r, 100));

  console.log(`[debug] Targeting ${block.name} at ${block.position}`);

  const isDiamond = block.name.includes("diamond");
  if (isDiamond) {
    if (!hasIronPickaxeOrBetter()) {
      sendMessage("⚠️ No iron+ pickaxe for diamond – changing direction");
      await tryChangeDirection();
      return false;
    }
    await equipBestPickaxe();
    const held = bot.heldItem;
    if (!held || !held.name.includes("pickaxe")) {
      sendMessage("❌ No pickaxe in hand – changing direction");
      await tryChangeDirection();
      return false;
    }
  } else {
    await equipBestPickaxe();
  }

  try {
    await bot.dig(block);
    console.log(`[mine] Broke ${block.name}`);
    tempFailedBlocks.delete(blockKey);

    if (isValuableOre(block)) {
      valuableOreCount++;
      oresSinceLastMsg++;
      if (oresSinceLastMsg >= config.messageInterval) {
        sendMessage(`⛏️ Mined ${valuableOreCount} valuable ores so far`);
        oresSinceLastMsg = 0;
      }
      if (isDiamond) sendMessage(`💎 Diamond ore found!`);
      else if (block.name.includes("redstone")) sendMessage(`🔴 Redstone ore found!`);
    }

    if (isFallingBlock(block)) {
      bot.setControlState("back", true);
      await new Promise(r => setTimeout(r, 300));
      bot.setControlState("back", false);
    }
    return true;
  } catch (err) {
    console.log(`[mine] Failed: ${err.message}`);
    if (retry && err.message.includes("Digging aborted")) {
      console.log(`[mine] Retrying once...`);
      await new Promise(r => setTimeout(r, 500));
      return breakBlock(block, false);
    } else {
      // Block is problematic – mark temporarily and change direction
      tempFailedBlocks.add(blockKey);
      sendMessage(`🔄 Cannot mine ${block.name}, changing direction...`);
      await tryChangeDirection();
      return false;
    }
  }
}

async function moveForward() {
  const pos = bot.entity.position;
  const frontFeet = bot.blockAt(pos.offset(0, 0, 1));
  const frontHead = bot.blockAt(pos.offset(0, 1, 1));
  if (isSolid(frontFeet) || isSolid(frontHead)) return false;

  bot.setControlState("forward", true);
  await new Promise(r => setTimeout(r, config.moveForwardTime));
  bot.setControlState("forward", false);
  return true;
}

// ========== SIDE ORE MINING ==========
async function mineAdjacentOres() {
  const pos = bot.entity.position;
  const directions = [
    { offset: [0, 0, 1], name: "front" },
    { offset: [0, 0, -1], name: "back" },
    { offset: [1, 0, 0], name: "right" },
    { offset: [-1, 0, 0], name: "left" },
    { offset: [0, 1, 0], name: "up" },
    { offset: [0, -1, 0], name: "down" }
  ];
  for (const dir of directions) {
    const block = bot.blockAt(pos.offset(dir.offset[0], dir.offset[1], dir.offset[2]));
    if (block && isValuableOre(block) && !isUnbreakable(block)) {
      console.log(`[side] Found ${block.name} ${dir.name}, mining...`);
      const success = await breakBlock(block);
      if (success) return true;
    }
  }
  return false;
}

// ========== OBSTRUCTION & DIRECTION CHANGE ==========
async function tryChangeDirection() {
  const now = Date.now();
  if (now - lastDirectionChange < config.directionChangeCooldown) return false;
  lastDirectionChange = now;

  // Clear temporary failed blocks when changing direction (fresh start)
  tempFailedBlocks.clear();

  const pos = bot.entity.position;
  const offsets = [
    { x: 1, z: 0 },  // right
    { x: -1, z: 0 }, // left
    { x: 0, z: -1 }, // back
  ];
  for (const off of offsets) {
    const targetPos = pos.offset(off.x, 0, off.z);
    const feet = bot.blockAt(targetPos);
    const head = bot.blockAt(targetPos.offset(0, 1, 0));
    if (!isSolid(feet) && !isSolid(head)) {
      await bot.pathfinder.goto(new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z));
      sendMessage(`🔄 Changed direction to ${off.x},${off.z}`);
      return true;
    }
  }
  // If all sides blocked, dig up
  const upBlock = bot.blockAt(pos.offset(0, 1, 0));
  if (upBlock && !isUnbreakable(upBlock)) {
    await breakBlock(upBlock);
    return true;
  }
  return false;
}

function checkStuck() {
  const now = Date.now();
  const currentPos = bot.entity.position.floored();
  if (lastPosition && currentPos.equals(lastPosition)) {
    if (now - lastMoveTime > config.stuckTimeout) {
      sendMessage("🚧 Stuck – changing direction");
      tryChangeDirection();
      lastMoveTime = now;
    }
  } else {
    lastPosition = currentPos;
    lastMoveTime = now;
  }
}

// ========== DIAMOND HANDLING ==========
async function giveDiamondsToNearestPlayer() {
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
  const total = diamonds.reduce((s, i) => s + i.count, 0);
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
  sendMessage(`Deposited ${diamonds.reduce((s, i) => s + i.count, 0)} diamonds`);
  await chest.close();
  return true;
}

// ========== DESCENT ==========
async function descendStep() {
  if (currentPhase !== "descending") return;
  if (bot.isSleeping) return;
  if (bot.entity.position.y <= config.diamondLevelY) {
    sendMessage(`✅ Reached diamond level. Starting strip mining.`);
    currentPhase = "stripMining";
    miningOrigin = bot.entity.position.floored();
    return;
  }
  const pos = bot.entity.position;
  const feet = bot.blockAt(pos.offset(0, 0, 1));
  const head = bot.blockAt(pos.offset(0, 1, 1));
  const below = bot.blockAt(pos.offset(0, -1, 1));
  if (isSolid(feet)) await breakBlock(feet);
  if (isSolid(head)) await breakBlock(head);
  if (isSolid(below)) await breakBlock(below);
  bot.setControlState("forward", true);
  await new Promise(r => setTimeout(r, 500));
  bot.setControlState("forward", false);
  const newFeet = bot.blockAt(bot.entity.position.offset(0, 0, 1));
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
  if (bot.isSleeping) return;
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

  // Mine adjacent ores first
  const minedSide = await mineAdjacentOres();
  if (minedSide) return;

  const pos = bot.entity.position;
  const feetBlock = bot.blockAt(pos.offset(0, 0, 1));
  const headBlock = bot.blockAt(pos.offset(0, 1, 1));
  const passable = b => !b || b.name === "air" || b.boundingBox !== "block";

  if (passable(feetBlock) && passable(headBlock)) {
    const moved = await moveForward();
    if (!moved) checkStuck();
    return;
  }

  // Break obstacles
  if (headBlock && !passable(headBlock)) {
    await breakBlock(headBlock);
    return;
  }
  if (feetBlock && !passable(feetBlock)) {
    await breakBlock(feetBlock);
    return;
  }

  const moved = await moveForward();
  if (!moved) checkStuck();
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
  if (bot.isSleeping) return;
  const time = bot.time.timeOfDay;
  if (time < 13000 || time > 24000) return;
  const bed = bot.findBlock({ matching: b => bot.isABed(b), maxDistance: 16 });
  if (!bed) return;
  sendMessage("Night time, sleeping...");
  try {
    await bot.sleep(bed);
    setTimeout(() => { if (bot.isSleeping) bot.wake(); }, 11000);
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
    else if (cmd === "!diamonds") {
      if (await giveDiamondsToNearestPlayer()) diamondCount = countDiamondsInInventory();
      else sendMessage("No diamonds or player nearby");
    }
    else if (cmd === "!chest") { currentPhase = "returningToChest"; }
  });
}

// ========== LOOPS ==========
function startBehaviors() {
  afkIntervals.mine = setInterval(async () => {
    if (!bot?.entity || bot.isSleeping) return;
    if (currentPhase === "descending") await descendStep();
    else if (currentPhase === "stripMining") await stripMineStep();
    else if (currentPhase === "returningToChest") await returnToChestAndBack();
  }, 2000);
  afkIntervals.sleep = setInterval(async () => { if (bot?.entity) await trySleep(); }, config.sleepCheckInterval);
}

function clearIntervals() { for (let key in afkIntervals) clearInterval(afkIntervals[key]); afkIntervals = {}; }

// ========== BOT START ==========
function createBot() {
  bot = mineflayer.createBot({ host: config.host, port: config.port, username: config.username, auth: config.auth });
  bot.loadPlugin(pathfinder);
  bot.once("spawn", () => {
    const mcData = require("minecraft-data")(bot.version);
    const moves = new Movements(bot, mcData);
    moves.allowParkour = false;
    moves.canDig = false;
    bot.pathfinder.setMovements(moves);
    console.log(`✅ Bot ready at ${bot.entity.position}`);
    sendMessage("Netherite mining bot online – will change direction if a block cannot be mined. Commands: !start, !stop, !status, !descend, !diamonds, !chest");
    setupChatCommands();
    startBehaviors();
    currentPhase = "descending";
    lastPosition = bot.entity.position.floored();
    lastMoveTime = Date.now();
  });
  bot.on("end", (reason) => { console.log(`Disconnected: ${reason}`); clearIntervals(); setTimeout(() => createBot(), 10000); });
  bot.on("kicked", (reason) => console.log("Kicked:", reason));
  bot.on("error", (err) => console.log("Error:", err));
}

createBot();
