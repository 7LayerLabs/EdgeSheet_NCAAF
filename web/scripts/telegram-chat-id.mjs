#!/usr/bin/env node
/**
 * Prints the chat ids your Telegram bot can see.
 *
 * 1. Put TELEGRAM_BOT_TOKEN=... in web/.env.local (token from @BotFather).
 * 2. Open the bot in Telegram and send it any message (for example "hi").
 * 3. Run:  node scripts/telegram-chat-id.mjs
 * 4. Copy the chat id into web/.env.local as TELEGRAM_CHAT_ID=...
 *
 * Note: if the bot is already running (pm2 scout-telegram), stop it first.
 * Only one process can poll getUpdates at a time, and the running bot also
 * prints unknown chat ids in its own log.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(web, ".env.local"));

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set. Add it to web/.env.local first (get one from @BotFather in Telegram).");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

const me = await api("getMe");
if (!me.ok) {
  console.error(`Token rejected by Telegram: ${me.description ?? "unknown error"}`);
  process.exit(1);
}
console.log(`Bot: @${me.result.username} (id ${me.result.id})`);

const upd = await api("getUpdates", { timeout: 0, allowed_updates: ["message", "channel_post", "my_chat_member"] });
if (!upd.ok) {
  console.error(`getUpdates failed: ${upd.description ?? "unknown error"}${upd.error_code === 409 ? " (another process is polling this bot; stop pm2 scout-telegram and retry)" : ""}`);
  process.exit(1);
}

const seen = new Map();
for (const u of upd.result) {
  const msg = u.message ?? u.channel_post ?? u.my_chat_member;
  const chat = msg?.chat;
  if (!chat) continue;
  const who = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? chat.username ?? "";
  seen.set(chat.id, { type: chat.type, who, last: msg.text ?? "" });
}

if (!seen.size) {
  console.log("No messages yet. Open the bot in Telegram, send it any message, then run this again.");
  console.log(`Link: https://t.me/${me.result.username}`);
  process.exit(0);
}

console.log("\nChat ids seen:");
for (const [id, info] of seen) console.log(`  ${id}  (${info.type}${info.who ? `, ${info.who}` : ""}${info.last ? `, last: "${info.last.slice(0, 40)}"` : ""})`);
const first = [...seen.keys()][0];
console.log(`\nAdd this line to web/.env.local (private chat ids are positive, groups are negative):\nTELEGRAM_CHAT_ID=${first}`);

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
