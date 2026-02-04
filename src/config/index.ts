export const config = {
  botToken: process.env.BOT_TOKEN || '',
  cloudStorageApiUrl: process.env.CLOUD_STORAGE_API_URL || 'http://localhost:7002',
  botApiKey: process.env.BOT_API_KEY || '',
  port: Number(process.env.PORT) || 3000,
  domain: process.env.DOMAIN || '',
};
