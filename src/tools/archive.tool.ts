/**
 * MCP tool: archive_emails — move one or more emails to the account's Archive mailbox.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import audit from '../safety/audit.js';

import type ImapService from '../services/imap.service.js';

export default function registerArchiveTools(server: McpServer, imapService: ImapService): void {
  server.tool(
    'archive_emails',
    "Move one or more emails to the account's Archive mailbox. " +
      'Accepts multiple message IDs for batch archiving. ' +
      'The source mailbox must be a real folder, not a virtual one like "All Mail". ' +
      'Use find_email_folder first if the email was discovered in a virtual folder.',
    {
      account: z.string().describe('Account name from list_accounts'),
      mailbox: z.string().default('INBOX').describe('Source mailbox containing the emails'),
      ids: z
        .array(z.number().int())
        .min(1)
        .max(100)
        .describe(
          'Array of email UIDs to archive (max 100). Get UIDs from list_emails or search_emails.',
        ),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ account, mailbox, ids }) => {
      try {
        const result = await imapService.archiveEmails(account, ids, mailbox);
        await audit.log('archive_emails', account, { mailbox, ids: ids.length }, 'ok');

        const summary =
          result.failed === 0
            ? `Archived ${result.succeeded} email${result.succeeded === 1 ? '' : 's'}.`
            : `Archived ${result.succeeded}/${result.total}. ${result.failed} failed.`;

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
          ],
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await audit.log('archive_emails', account, { mailbox, ids: ids.length }, 'error', errMsg);
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to archive emails: ${errMsg}`,
            },
          ],
        };
      }
    },
  );
}
