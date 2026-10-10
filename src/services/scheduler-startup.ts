/**
 * Post-handshake scheduler startup.
 *
 * Enabled: sends overdue scheduled emails, then checks the queue every 60 seconds.
 * Disabled: starts nothing, and warns if emails are still queued, since this
 * server will neither send them nor offer tools to list or cancel them.
 */

import { mcpLog } from '../logging.js';
import type SchedulerService from './scheduler.service.js';

export const SCHEDULER_INTERVAL_MS = 60_000;

/** Start the scheduler as configured. Resolves to a function that stops it. */
export default async function startScheduler(
  schedulerService: SchedulerService,
  enabled: boolean,
): Promise<() => void> {
  if (!enabled) {
    try {
      const pending = await schedulerService.list({ status: 'pending' });
      if (pending.length > 0) {
        await mcpLog(
          'warning',
          'scheduler',
          `Scheduler disabled: ${pending.length} queued email(s) won't be sent by this server. ` +
            "Run 'email-mcp scheduler check' to send them.",
        );
      }
    } catch {
      // Non-fatal: an unreadable queue shouldn't prevent server start
    }
    return () => {};
  }

  // Check for overdue scheduled emails on startup
  try {
    const result = await schedulerService.checkAndSend();
    if (result.sent > 0) {
      await mcpLog('info', 'scheduler', `Sent ${result.sent} overdue email(s) on startup`);
    }
  } catch {
    // Non-fatal: scheduler check failure shouldn't prevent server start
  }

  // Periodic scheduler check every 60 seconds
  const interval = setInterval(async () => {
    try {
      await schedulerService.checkAndSend();
    } catch {
      // Silent — don't spam logs
    }
  }, SCHEDULER_INTERVAL_MS);

  return () => clearInterval(interval);
}
