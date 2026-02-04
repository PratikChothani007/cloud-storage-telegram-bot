import 'dotenv/config';
import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import { cloudStorageApi, CloudStorageApiError } from './services/cloudStorageApi.js';

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('BOT_TOKEN is missing in .env');
}

export const bot = new Bot(token);

// Set up bot commands menu
export const setupBotCommands = async () => {
    await bot.api.setMyCommands([
        { command: 'start', description: 'Start the bot and register' },
        { command: 'status', description: 'Check your account status' },
        { command: 'link_list', description: 'View all your shared links' },
        { command: 'delete_link', description: 'Delete a shareable link' },
        { command: 'delete_account', description: 'Delete your account' },
        { command: 'help', description: 'Show help message' },
    ]);
    console.log('Bot commands menu configured');
};

// Store user tokens in memory (in production, use Redis or database)
const userTokens = new Map<number, string>();

// Track processed updates to prevent duplicates (in production, use Redis with TTL)
const processedUpdates = new Set<number>();
const MAX_PROCESSED_UPDATES = 1000;

const isProcessed = (updateId: number): boolean => {
    if (processedUpdates.has(updateId)) {
        return true;
    }
    // Clean up old entries if too many
    if (processedUpdates.size >= MAX_PROCESSED_UPDATES) {
        const toDelete = Array.from(processedUpdates).slice(0, 500);
        toDelete.forEach(id => processedUpdates.delete(id));
    }
    processedUpdates.add(updateId);
    return false;
};

// Helper function to get user display name
const getUserDisplayName = (from: { first_name: string; last_name?: string; username?: string }): string => {
    if (from.first_name && from.last_name) {
        return `${from.first_name} ${from.last_name}`;
    }
    return from.first_name || from.username || 'User';
};

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Helper function to download file from Telegram
const downloadTelegramFile = async (fileId: string): Promise<Buffer> => {
    const file = await bot.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) {
        throw new Error('Could not get file path from Telegram');
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const response = await fetch(fileUrl);

    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
};

// Fast upload using presigned S3 URL (bypasses backend for file data)
const fastUploadFile = async (
    telegramId: string,
    fileId: string,
    filename: string,
    contentType: string,
    fileSize: number
): Promise<{ shareableLink: string; filename: string; size: number }> => {
    // Step 1: Get presigned upload URL from backend
    const urlResponse = await cloudStorageApi.getUploadUrl({
        telegramId,
        filename,
        contentType,
        fileSize,
    });

    // Step 2: Download from Telegram
    const fileBuffer = await downloadTelegramFile(fileId);

    // Step 3: Upload directly to S3 (fast - no backend middleman)
    await cloudStorageApi.uploadToS3(
        urlResponse.data.uploadUrl,
        fileBuffer,
        contentType
    );

    // Step 4: Complete upload and get share link
    const completeResponse = await cloudStorageApi.completeUpload({
        telegramId,
        fsObjectId: urlResponse.data.fsObjectId,
    });

    return {
        shareableLink: completeResponse.data.shareableLink,
        filename: completeResponse.data.filename,
        size: completeResponse.data.size,
    };
};

// Helper function to ensure user is registered
const ensureUserRegistered = async (telegramId: string, userName?: string | undefined): Promise<boolean> => {
    try {
        await cloudStorageApi.createUser({
            telegramId,
            name: userName,
        });
        return true;
    } catch (error) {
        console.error('Error ensuring user registration:', error);
        return false;
    }
};

// /start command - auto-register user with cloud storage
bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const userName = ctx.from ? getUserDisplayName(ctx.from) : undefined;

    try {
        const response = await cloudStorageApi.createUser({
            telegramId,
            name: userName,
        });

        // Store token for future API calls
        userTokens.set(ctx.from!.id, response.data.token);

        if (response.data.isNewUser) {
            return ctx.reply(
                `Welcome to Cloud Storage, ${response.data.user.name}! 🎉\n\n` +
                `Your account has been created successfully.\n\n` +
                `You can now send me any file (document, photo, or video) and I'll:\n` +
                `1. Upload it to your cloud storage\n` +
                `2. Give you a shareable link\n\n` +
                `Use /help to see all available commands.`
            );
        } else {
            return ctx.reply(
                `Welcome back, ${response.data.user.name}! 👋\n\n` +
                `Your account is already set up and ready to use.\n\n` +
                `Send me any file to upload it to your cloud storage!`
            );
        }
    } catch (error) {
        console.error('Error creating user:', error);

        if (error instanceof CloudStorageApiError) {
            return ctx.reply(
                `Failed to register: ${error.message}\n` +
                `Please try again later or contact support.`
            );
        }

        return ctx.reply(
            'An unexpected error occurred while setting up your account.\n' +
            'Please try again later.'
        );
    }
});

// /status command - check account status
bot.command('status', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    try {
        const response = await cloudStorageApi.createUser({
            telegramId,
        });

        const user = response.data.user;

        let statusMessage =
            `📊 Account Status\n\n` +
            `Name: ${user.name}\n` +
            `Account ID: \`${user.id.slice(0, 8)}XXX${user.id.slice(-4)}\`\n` +
            `Phone: ${user.phoneNumber || 'Not provided'}\n` +
            `Phone Verified: ${user.isPhoneVerified ? 'Yes ✅' : 'No ❌'}\n` +
            `Created: ${new Date(user.createdAt).toLocaleDateString()}`;

        // If phone is not verified, show button to share contact
        if (!user.isPhoneVerified) {
            statusMessage += `\n\n📱 Share your phone number to verify your account and unlock additional features.`;

            const keyboard = new Keyboard()
                .requestContact('📱 Share Phone Number')
                .resized()
                .oneTime();

            return ctx.reply(statusMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
            });
        }

        return ctx.reply(statusMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error checking status:', error);

        if (error instanceof CloudStorageApiError) {
            return ctx.reply(
                `Could not fetch account status: ${error.message}\n` +
                `Use /start to create an account.`
            );
        }

        return ctx.reply(
            'An unexpected error occurred.\n' +
            'Please try again later.'
        );
    }
});

// /help command
bot.command('help', (ctx) => {
    return ctx.reply(
        `🤖 Cloud Storage Bot Commands\n\n` +
        `/start - Start the bot and register\n` +
        `/status - Check your account status\n` +
        `/link_list - View all your shared links with views\n` +
        `/delete_link - Delete a shareable link\n` +
        `/delete_account - Delete your account\n` +
        `/help - Show this help message\n\n` +
        `📁 File Upload:\n` +
        `Simply send me any file, photo, or video and I'll:\n` +
        `• Upload it to your cloud storage\n` +
        `• Generate a shareable link for you\n\n` +
        `Supported: Documents, Photos, Videos, Audio files`
    );
});

// /delete_account command - delete user account with confirmation
bot.command('delete_account', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const keyboard = new InlineKeyboard()
        .text('⚠️ Yes, delete my account', 'confirm_delete_account')
        .row()
        .text('❌ Cancel', 'cancel_delete_account');

    return ctx.reply(
        `⚠️ Delete Account\n\n` +
        `Are you sure you want to delete your account?\n\n` +
        `This will permanently delete:\n` +
        `• All your uploaded files\n` +
        `• All your shareable links\n` +
        `• Your account data\n\n` +
        `⛔ This action cannot be undone!`,
        { reply_markup: keyboard }
    );
});

// Handle delete account confirmation
bot.callbackQuery('confirm_delete_account', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        await ctx.answerCallbackQuery({ text: 'Could not identify your account.' });
        return;
    }

    try {
        await cloudStorageApi.deleteAccount(telegramId);

        await ctx.answerCallbackQuery({ text: 'Account deleted' });
        await ctx.editMessageText(
            `✅ Account Deleted\n\n` +
            `Your account and all associated data have been deleted.\n\n` +
            `Thank you for using Cloud Storage Bot.\n` +
            `If you change your mind, use /start to create a new account.`
        );
    } catch (error) {
        console.error('Error deleting account:', error);

        let errorMessage = 'Failed to delete account.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.answerCallbackQuery({ text: errorMessage, show_alert: true });
    }
});

// Handle cancel delete account
bot.callbackQuery('cancel_delete_account', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.editMessageText(
        `✅ Account deletion cancelled.\n\n` +
        `Your account is safe. Use /help to see available commands.`
    );
});

// /link_list command - show shared links with view counts and pagination
bot.command('link_list', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    await showLinksPage(ctx, telegramId, 1);
});

// Helper function to show links page
async function showLinksPage(ctx: any, telegramId: string, page: number) {
    try {
        const response = await cloudStorageApi.getLinksWithViews({
            telegramId,
            page,
            limit: 5,
        });

        const { links, pagination } = response.data;

        if (links.length === 0 && page === 1) {
            return ctx.reply(
                `📭 No shared links found.\n\n` +
                `Upload a file and I'll generate a shareable link for you.`
            );
        }

        // Build message
        let message = `🔗 Your Shared Links (Page ${pagination.page}/${pagination.totalPages})\n`;
        message += `Total: ${pagination.total} links\n\n`;

        links.forEach((link, index) => {
            const num = (pagination.page - 1) * pagination.limit + index + 1;
            const viewEmoji = link.viewCount > 0 ? '👁' : '👁‍🗨';
            message += `${num}. ${link.filename}\n`;
            message += `   📦 ${formatFileSize(link.size)} | ${viewEmoji} ${link.viewCount} views\n`;
            message += `   🔗 ${link.shareableLink}\n\n`;
        });

        // Build pagination keyboard
        const keyboard = new InlineKeyboard();

        if (pagination.page > 1) {
            keyboard.text('⬅️ Previous', `links_page:${pagination.page - 1}`);
        }

        if (pagination.page < pagination.totalPages) {
            keyboard.text('Next ➡️', `links_page:${pagination.page + 1}`);
        }

        if (pagination.totalPages > 1) {
            keyboard.row();
            keyboard.text(`📄 ${pagination.page}/${pagination.totalPages}`, 'links_page:noop');
        }

        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, { reply_markup: keyboard });
        } else {
            await ctx.reply(message, { reply_markup: keyboard });
        }
    } catch (error) {
        console.error('Error getting links:', error);

        let errorMessage = 'Failed to get links.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: errorMessage, show_alert: true });
        } else {
            await ctx.reply(`❌ ${errorMessage}\n\nPlease try again later.`);
        }
    }
}

// Handle links pagination callback queries
bot.callbackQuery(/^links_page:(.+)$/, async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        await ctx.answerCallbackQuery({ text: 'Could not identify your account.' });
        return;
    }

    const action = ctx.match?.[1];
    if (!action || action === 'noop') {
        await ctx.answerCallbackQuery();
        return;
    }

    const page = parseInt(action, 10);
    if (isNaN(page)) {
        await ctx.answerCallbackQuery({ text: 'Invalid page.' });
        return;
    }

    await ctx.answerCallbackQuery();
    await showLinksPage(ctx, telegramId, page);
});

// /delete_link command - show shared files with delete buttons
bot.command('delete_link', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    try {
        const response = await cloudStorageApi.listSharedFiles(telegramId);
        const files = response.data.files;

        if (files.length === 0) {
            return ctx.reply(
                `📭 No shared files found.\n\n` +
                `Upload a file first, and I'll generate a shareable link for you.`
            );
        }

        // Create inline keyboard with delete buttons
        const keyboard = new InlineKeyboard();

        files.slice(0, 10).forEach((file, index) => {
            const displayName = file.filename.length > 25
                ? file.filename.substring(0, 22) + '...'
                : file.filename;
            keyboard.text(`🗑 ${displayName}`, `delete_link:${file.fsObjectId}`).row();
        });

        keyboard.text('❌ Cancel', 'delete_link:cancel');

        return ctx.reply(
            `🔗 Your Shared Files\n\n` +
            `Select a file to delete its shareable link:\n\n` +
            files.slice(0, 10).map((f, i) =>
                `${i + 1}. ${f.filename} (${formatFileSize(f.size)})`
            ).join('\n') +
            (files.length > 10 ? `\n\n...and ${files.length - 10} more` : ''),
            { reply_markup: keyboard }
        );
    } catch (error) {
        console.error('Error listing shared files:', error);

        if (error instanceof CloudStorageApiError) {
            return ctx.reply(`Failed to list shared files: ${error.message}`);
        }

        return ctx.reply('An unexpected error occurred. Please try again later.');
    }
});

// Handle delete_link callback queries
bot.callbackQuery(/^delete_link:(.+)$/, async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        await ctx.answerCallbackQuery({ text: 'Could not identify your account.' });
        return;
    }

    const fsObjectId = ctx.match?.[1];
    if (!fsObjectId) {
        await ctx.answerCallbackQuery({ text: 'Invalid request.' });
        return;
    }

    // Handle cancel
    if (fsObjectId === 'cancel') {
        await ctx.answerCallbackQuery({ text: 'Cancelled' });
        await ctx.editMessageText('Operation cancelled.');
        return;
    }

    try {
        const response = await cloudStorageApi.deleteShareLink({
            telegramId,
            fsObjectId,
        });

        await ctx.answerCallbackQuery({ text: 'Share link deleted!' });
        await ctx.editMessageText(
            `✅ Share link deleted successfully!\n\n` +
            `File: ${response.data.filename}\n\n` +
            `The shareable link for this file is no longer active.`
        );
    } catch (error) {
        console.error('Error deleting share link:', error);

        let errorMessage = 'Failed to delete share link.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.answerCallbackQuery({ text: errorMessage, show_alert: true });
    }
});

// Handle document uploads
bot.on('message:document', async (ctx) => {
    // Prevent duplicate processing
    if (isProcessed(ctx.update.update_id)) {
        console.log(`Skipping duplicate update: ${ctx.update.update_id}`);
        return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const document = ctx.message.document;
    const fileName = document.file_name || 'unnamed_file';
    const mimeType = document.mime_type || 'application/octet-stream';
    const fileSize = document.file_size || 0;

    // Check file size (Telegram bot API limit is 20MB)
    if (fileSize > 20 * 1024 * 1024) {
        return ctx.reply(
            '❌ File too large!\n\n' +
            'Maximum file size is 20MB.\n' +
            'Please use a smaller file or compress it first.'
        );
    }

    const statusMsg = await ctx.reply(
        `📤 Uploading "${fileName}"...\n` +
        `Size: ${formatFileSize(fileSize)}`
    );

    try {
        // Ensure user is registered
        const userName = ctx.from ? getUserDisplayName(ctx.from) : undefined;
        await ensureUserRegistered(telegramId, userName);

        // Fast upload using presigned URL
        const result = await fastUploadFile(
            telegramId,
            document.file_id,
            fileName,
            mimeType,
            fileSize
        );

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `✅ Upload complete!\n\n` +
            `📄 File: ${result.filename}\n` +
            `📦 Size: ${formatFileSize(result.size)}\n\n` +
            `🔗 Shareable Link:\n${result.shareableLink}`
        );
    } catch (error) {
        console.error('Error uploading document:', error);

        let errorMessage = 'Failed to upload file.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ Upload failed!\n\n${errorMessage}\n\nPlease try again.`
        );
    }
});

// Handle photo uploads
bot.on('message:photo', async (ctx) => {
    // Prevent duplicate processing
    if (isProcessed(ctx.update.update_id)) {
        console.log(`Skipping duplicate update: ${ctx.update.update_id}`);
        return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    // Get the largest photo (last in array)
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    if (!photo) {
        return ctx.reply('Could not process this photo. Please try again.');
    }

    const fileSize = photo.file_size || 0;
    const fileName = `photo_${Date.now()}.jpg`;

    const statusMsg = await ctx.reply(
        `📤 Uploading photo...\n` +
        `Size: ${formatFileSize(fileSize)}`
    );

    try {
        // Ensure user is registered
        const userName = ctx.from ? getUserDisplayName(ctx.from) : undefined;
        await ensureUserRegistered(telegramId, userName);

        // Fast upload using presigned URL
        const result = await fastUploadFile(
            telegramId,
            photo.file_id,
            fileName,
            'image/jpeg',
            fileSize
        );

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `✅ Photo uploaded!\n\n` +
            `📸 Size: ${formatFileSize(result.size)}\n\n` +
            `🔗 Shareable Link:\n${result.shareableLink}`
        );
    } catch (error) {
        console.error('Error uploading photo:', error);

        let errorMessage = 'Failed to upload photo.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ Upload failed!\n\n${errorMessage}\n\nPlease try again.`
        );
    }
});

// Handle video uploads
bot.on('message:video', async (ctx) => {
    // Prevent duplicate processing
    if (isProcessed(ctx.update.update_id)) {
        console.log(`Skipping duplicate update: ${ctx.update.update_id}`);
        return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const video = ctx.message.video;
    const fileName = video.file_name || `video_${Date.now()}.mp4`;
    const mimeType = video.mime_type || 'video/mp4';
    const fileSize = video.file_size || 0;

    // Check file size (Telegram bot API limit is 20MB)
    if (fileSize > 20 * 1024 * 1024) {
        return ctx.reply(
            '❌ Video too large!\n\n' +
            'Maximum file size is 20MB.\n' +
            'Please use a smaller video or compress it first.'
        );
    }

    const statusMsg = await ctx.reply(
        `📤 Uploading video "${fileName}"...\n` +
        `Size: ${formatFileSize(fileSize)}`
    );

    try {
        // Ensure user is registered
        const userName = ctx.from ? getUserDisplayName(ctx.from) : undefined;
        await ensureUserRegistered(telegramId, userName);

        // Fast upload using presigned URL
        const result = await fastUploadFile(
            telegramId,
            video.file_id,
            fileName,
            mimeType,
            fileSize
        );

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `✅ Video uploaded!\n\n` +
            `🎬 File: ${result.filename}\n` +
            `📦 Size: ${formatFileSize(result.size)}\n\n` +
            `🔗 Shareable Link:\n${result.shareableLink}`
        );
    } catch (error) {
        console.error('Error uploading video:', error);

        let errorMessage = 'Failed to upload video.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ Upload failed!\n\n${errorMessage}\n\nPlease try again.`
        );
    }
});

// Handle audio uploads
bot.on('message:audio', async (ctx) => {
    // Prevent duplicate processing
    if (isProcessed(ctx.update.update_id)) {
        console.log(`Skipping duplicate update: ${ctx.update.update_id}`);
        return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const audio = ctx.message.audio;
    const fileName = audio.file_name || `audio_${Date.now()}.mp3`;
    const mimeType = audio.mime_type || 'audio/mpeg';
    const fileSize = audio.file_size || 0;

    // Check file size
    if (fileSize > 20 * 1024 * 1024) {
        return ctx.reply(
            '❌ Audio file too large!\n\n' +
            'Maximum file size is 20MB.'
        );
    }

    const statusMsg = await ctx.reply(
        `📤 Uploading audio "${fileName}"...\n` +
        `Size: ${formatFileSize(fileSize)}`
    );

    try {
        // Ensure user is registered
        const userName = ctx.from ? getUserDisplayName(ctx.from) : undefined;
        await ensureUserRegistered(telegramId, userName);

        // Fast upload using presigned URL
        const result = await fastUploadFile(
            telegramId,
            audio.file_id,
            fileName,
            mimeType,
            fileSize
        );

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `✅ Audio uploaded!\n\n` +
            `🎵 File: ${result.filename}\n` +
            `📦 Size: ${formatFileSize(result.size)}\n\n` +
            `🔗 Shareable Link:\n${result.shareableLink}`
        );
    } catch (error) {
        console.error('Error uploading audio:', error);

        let errorMessage = 'Failed to upload audio.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ Upload failed!\n\n${errorMessage}\n\nPlease try again.`
        );
    }
});

// Handle voice messages
bot.on('message:voice', async (ctx) => {
    // Prevent duplicate processing
    if (isProcessed(ctx.update.update_id)) {
        console.log(`Skipping duplicate update: ${ctx.update.update_id}`);
        return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const voice = ctx.message.voice;
    const fileName = `voice_${Date.now()}.ogg`;
    const mimeType = voice.mime_type || 'audio/ogg';
    const fileSize = voice.file_size || 0;

    const statusMsg = await ctx.reply(
        `📤 Uploading voice message...\n` +
        `Size: ${formatFileSize(fileSize)}`
    );

    try {
        // Ensure user is registered
        const userName = ctx.from ? getUserDisplayName(ctx.from) : undefined;
        await ensureUserRegistered(telegramId, userName);

        // Fast upload using presigned URL
        const result = await fastUploadFile(
            telegramId,
            voice.file_id,
            fileName,
            mimeType,
            fileSize
        );

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `✅ Voice message uploaded!\n\n` +
            `🎤 Size: ${formatFileSize(result.size)}\n\n` +
            `🔗 Shareable Link:\n${result.shareableLink}`
        );
    } catch (error) {
        console.error('Error uploading voice:', error);

        let errorMessage = 'Failed to upload voice message.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        await ctx.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ Upload failed!\n\n${errorMessage}\n\nPlease try again.`
        );
    }
});

// Handle contact sharing (phone number verification)
bot.on('message:contact', async (ctx) => {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
        return ctx.reply('Could not identify your account. Please try again.');
    }

    const contact = ctx.message.contact;

    // Verify that the contact is from the user themselves (not forwarded)
    if (contact.user_id?.toString() !== telegramId) {
        return ctx.reply(
            '❌ Please share your own phone number, not someone else\'s contact.',
            { reply_markup: { remove_keyboard: true } }
        );
    }

    const phoneNumber = contact.phone_number;

    // Ensure phone number has + prefix
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    try {
        const response = await cloudStorageApi.updatePhone({
            telegramId,
            phoneNumber: formattedPhone,
        });

        return ctx.reply(
            `✅ Phone number verified successfully!\n\n` +
            `📱 Phone: ${response.data.user.phoneNumber}\n\n` +
            `Your account is now fully verified.`,
            { reply_markup: { remove_keyboard: true } }
        );
    } catch (error) {
        console.error('Error updating phone:', error);

        let errorMessage = 'Failed to verify phone number.';
        if (error instanceof CloudStorageApiError) {
            errorMessage = error.message;
        }

        return ctx.reply(
            `❌ ${errorMessage}\n\nPlease try again later.`,
            { reply_markup: { remove_keyboard: true } }
        );
    }
});

// Handle unknown text messages
bot.on('message:text', (ctx) => {
    return ctx.reply(
        `I don't understand that command.\n\n` +
        `Send me a file, photo, or video to upload it to your cloud storage.\n` +
        `Use /help to see available commands.`
    );
});

// Global error handler
bot.catch((err) => {
    console.error('Bot error:', err.error);
});

console.log('Bot handlers registered');
