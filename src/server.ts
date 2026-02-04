import 'dotenv/config';
import express from 'express';
import { webhookCallback } from 'grammy';
import { bot, setupBotCommands } from './bot.js';

const app = express();
const port = Number(process.env.PORT) || 3000;
const domain = String(process.env.DOMAIN);

// Parse JSON bodies (Telegram sends JSON)
app.use(express.json());

// Health check endpoint
app.get('/', (_req, res) => {
    res.json({ status: 'Bot is alive 👋', timestamp: new Date().toISOString() });
});

// Secret webhook path (hard to guess)
const secretPath = `/webhook/${process.env.BOT_TOKEN}`;

// Mount grammY webhook handler with increased timeout (60 seconds)
app.use(secretPath, webhookCallback(bot, 'express', {
    timeoutMilliseconds: 60000,
}));

// Graceful shutdown
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

app.listen(port, async () => {
    console.log(`🚀 Server running on port ${port}`);

    // Set Telegram webhook
    const webhookUrl = `${domain}${secretPath}`;
    await bot.api.setWebhook(webhookUrl);
    console.log(`✅ Webhook set: ${webhookUrl}`);

    // Set up bot commands menu
    await setupBotCommands();
});