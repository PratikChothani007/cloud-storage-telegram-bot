import 'dotenv/config';
import { Bot } from 'grammy';

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('BOT_TOKEN is missing in .env');
}

export const bot = new Bot(token);

// List of random messages
const randomMessages = [
    'આવા દો મોરે મોરો',
    'તમે મારી આબરું કાઢી છે, હવે આપણે લડી લઈશું',
    'બધાય ઘાયલ બેઠા લાગે છે',
    'સગા છે એ વાલા નથી',
    'મારુ English પાવરફુલ છે હો',
    'પૈસાનો પાવર કોઈનો રહ્યો નથી રેવાનો નથી',
    'મરી જાય પછી લખે મિસ યુ સાવજ',
    'મિસ કોલ આવે ત્યારે ખબર પડે કાનો હજી જાગે છે',
    'અમુક તો સાલા બાયલા ના ચાહક છે',
    'કુતરા હાટુ હાથી પાછો ના ફરે'
];

// Helper function to get a random message
const getRandomMessage = (): string => {
    const randomIndex = Math.floor(Math.random() * randomMessages.length);
    return randomMessages[randomIndex]!;
};

// /start command
bot.command('start', ctx =>
    ctx.reply(getRandomMessage())
);

// simple text echo
bot.on('message:text', ctx =>
    ctx.reply(getRandomMessage())
);

// global error handler (good practice)
bot.catch(err => {
    console.error('Bot error:', err.error);
});

console.log('Bot handlers registered');
