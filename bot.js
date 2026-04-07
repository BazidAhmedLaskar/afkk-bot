// bot.js – Strip mining, chat commands, sleeping, health server
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
              // match your server

  // Strip mining settings
  stripMining: true,            // start strip mining on login
  tunnelWidth: 1,               // 1 block wide
  tunnelHeight: 2,              // 2 blocks tall (standard)
  blocksToMine: ["stone", "deepslate", "dirt", "coal_ore", "iron_ore"],
  stopWhenFull: true,           // stop if inventory full
  messageInterval: 10,          // announce every 10 blocks mined

  // Other behaviors
  jumpInterval: 4000,
  sleepCheckInterval: 60000,
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

// ------------------- Strip Mining Core -------------------
async function stripMineStep() {
  if (!stripMiningActive) return;
  if (bot.isSleeping) return;
  if (!bot.entity) return;

  // 1. Check inventory space (optional)
  if (config.stopWhenFull && isInventoryFull()) {
    sendMessage("Inventory full, stopping mining");
    stripMiningActive = false;
    return;
  }

  // 2. Get blocks to break: head level (y+1) and floor (y)
  const pos = bot.entity.position;
  const floorBlock = bot.blockAt(pos.offset(0, 0, 1));   // block in front at feet
  const headBlock = bot.blockAt(pos.offset(0, 1, 1));    // block in front at head

  const blocksToBreak = [];
  if (floorBlock && config.blocksToMine.includes(floorBlock.name)) blocksToBreak.push(floorBlock);
  if (headBlock && config.blocksToMine.includes(headBlock.name)) blocksToBreak.push(headBlock);

  if (blocksToBreak.length === 0) {
    // No mineable blocks directly ahead – move forward
    await moveForward();
    return;
  }

  // 3. Break blocks in order (head first to avoid falling gravel)
  for (const block of blocksToBreak) {
    await breakBlock(block);
    if (block.name.includes("ore")) {
      sendMessage(`Found ${block.name}!`);
    }
    blocksMinedTotal++;
    blocksMinedSinceLastMsg++;
    if (blocksMinedSinceLastMsg >= config.messageInterval) {
      sendMessage(`Mined ${blocksMinedTotal} blocks total`);
      blocksMinedSinceLastMsg = 0;
    }
  }

  // 4. Move forward after clearing
  await moveForward();
}

async function breakBlock(block) {
  // Stop movement
  ["forward", "back", "left", "right"].forEach(d => bot.setControlState(d, false));
  await new Promise(resolve => setTimeout(resolve, 100));

  // Face block
  await bot.lookAt(block.position);

  // Dig
  try {
    await bot.dig(block);
    console.log(`[mine] Broke ${block.name}`);
  } catch (err) {
    console.log(`[mine] Failed to break ${block.name}: ${err.message}`);
  }
}

async function moveForward() {
  // Ensure we are not colliding
  bot.setControlState("forward", true);
  await new Promise(resolve => setTimeout(resolve, 800)); // move for 0.8 sec
  bot.setControlState("forward", false);
}

function isInventoryFull() {
  const slots = bot.inventory.slots;
  const emptySlots = slots.filter(s => s === null).length;
  return emptySlots < 5; // less than 5 free slots = full
}

// ------------------- Chat Command Handler -------------------
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
    } else if (cmd === "!sleep") {
      bot.chat("/weather rain"); // just a joke, but you can add manual sleep
    }
  });
}

// ------------------- Sleeping (unchanged from before) -------------------
async function trySleep() {
  if (bot.isSleeping) return;
  const time = bot.time.timeOfDay;
  const isNight = time > 13000 && time < 24000;
  if (!isNight) return;

  const bed = bot.findBlock({ matching: (block) => bot.isABed(block), maxDistance: 16 });
  if (!bed) return;

  sendMessage("Night time, going to sleep");
  try {
    await bot.sleep(bed);
    setTimeout(() => {
      if (bot.isSleeping) bot.wake();
    }, 11000);
  } catch (err) {
    console.log(`Sleep failed: ${err.message}`);
  }
}

// ------------------- AFK & Mining Loops -------------------
function startBehaviors() {
  // Jump (optional, can be disabled while mining)
  afkIntervals.jump = setInterval(() => {
    if (!bot?.entity || stripMiningActive) return; // no jump while strip mining (avoid interrupting)
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 200);
  }, config.jumpInterval);

  // Strip mining step
  afkIntervals.mine = setInterval(async () => {
    if (!bot?.entity) return;
    if (stripMiningActive && !bot.isSleeping) {
      await stripMineStep();
    }
  }, 2000); // mine one step every 2 seconds

  // Sleep check
  afkIntervals.sleep = setInterval(async () => {
    if (!bot?.entity) return;
    await trySleep();
  }, config.sleepCheckInterval);
}

function clearIntervals() {
  for (let key in afkIntervals) {
    clearInterval(afkIntervals[key]);
    clearTimeout(afkIntervals[key]);
  }
  afkIntervals = {};
}

// ------------------- Bot Creation -------------------
function createBot() {
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version,
  });

  bot.once("spawn", () => {
    console.log(`✅ Bot spawned at ${bot.entity.position}`);
    sendMessage("Hello! I am a strip mining bot. Type !start, !stop, !status");
    setupChatCommands();
    startBehaviors();
  });

  bot.on("end", (reason) => {
    console.log(`Disconnected: ${reason}`);
    clearIntervals();
    setTimeout(() => createBot(), 10000);
  });

  bot.on("kicked", (reason) => console.log("Kicked:", reason));
  bot.on("error", (err) => console.log("Error:", err));
}

createBot();