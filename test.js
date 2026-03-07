require('dotenv').config();

const readline = require('readline');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const buildSystemInstruction = require('./buildInstruction');

// ─── Load system instruction from products.json ───────────────────────────────
const systemInstruction = buildSystemInstruction();

// ─── Gemini client ────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction,
});
const chat = model.startChat();

// ─── SQLite ───────────────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new DatabaseSync(path.join(dataDir, 'chat.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    message_text TEXT NOT NULL,
    sender_type  TEXT NOT NULL CHECK(sender_type IN ('user','bot')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
const insertMessage = db.prepare(
  'INSERT INTO messages (phone_number, message_text, sender_type) VALUES (?, ?, ?)'
);

const TEST_PHONE = 'terminal_test';

// ─── Interactive loop ─────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n=== WhatsApp Bot — Terminal Test ===');
console.log('System instruction loaded from products.json');
console.log('Type your message and press Enter. Ctrl+C to quit.\n');

const ask = () => {
  rl.question('You: ', async (userMessage) => {
    userMessage = userMessage.trim();
    if (!userMessage) return ask();

    insertMessage.run(TEST_PHONE, userMessage, 'user');

    try {
      const result = await chat.sendMessage(userMessage);
      const botReply = result.response.text();
      insertMessage.run(TEST_PHONE, botReply, 'bot');
      console.log(`\nBot: ${botReply}\n`);
    } catch (err) {
      console.error('Gemini error:', err.message);
    }

    ask();
  });
};

ask();
