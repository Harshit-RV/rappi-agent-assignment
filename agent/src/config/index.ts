import { configDotenv } from 'dotenv';

configDotenv();

export default {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
};
