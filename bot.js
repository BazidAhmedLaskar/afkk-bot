// bot.js – guaranteed connection attempt
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
  host: "bax_10.aternos.me",   // verify this exactly
  port: 55505,                 // verify this matches Aternos
  username: "samadul_gay",
  auth: "offline",             // CRITICAL for cracked servers
  version: "1.20.4",           // change to match your server's version
  // other AFK settings...
  jumpInterval: 4000,
  runInterval: 1500,
  breakInterval: 5000,
  breakScanRadius: 5,
  breakOnly: ["dirt", "grass_block", "grass", "stone"],
  rejoinInterval: false,
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
    console.error("[bot] FATAL error during bot creation:", err);
    process.exit(1); // so Render restarts
  }

  bot.once("login", () => {
    console.log(`✅✅✅ BOT JOINED THE SERVER as ${bot.username} ✅✅✅`);
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

function clearAFKIntervals() { /* same as before */ }
function startAFK() { /* same as before */ }
async function tryBreakBlock() { /* same as before */ }

// Start the bot
createBot();