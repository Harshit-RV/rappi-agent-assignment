import { configDotenv } from 'dotenv';

configDotenv();

export default {
  port: Number(process.env.PORT) || 3001,
};
