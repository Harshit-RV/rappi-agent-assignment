import { tool } from 'ai';
import { z } from 'zod';

export function createTools() {
  return {
    get_current_time: tool({
      description:
        'Get the current date and time in ISO 8601 format, optionally for a specific IANA timezone.',
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe('IANA timezone name, e.g. "Asia/Kolkata". Defaults to UTC.'),
      }),
      execute: async ({ timezone }) => {
        const now = new Date();
        return {
          iso: now.toISOString(),
          timezone: timezone ?? 'UTC',
          formatted: now.toLocaleString('en-IN', { timeZone: timezone ?? 'UTC' }),
        };
      },
    }),
  };
}
