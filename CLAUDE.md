# Email MCP Server

An MCP (Model Context Protocol) server exposing email operations over IMAP/SMTP.

## Tech Stack

- **Language**: TypeScript (Node.js >= 24)
- **Protocol**: IMAP (imapflow) + SMTP (nodemailer), NOT JMAP
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Validation**: Zod schemas for tool inputs
- **Testing**: Vitest (unit + integration)
- **Linting**: Biome (formatting) + ESLint

## Project Structure

```
src/
  tools/         # MCP tool definitions (one file per tool group)
  services/      # Business logic (imap.service.ts is the core)
  connections/   # IMAP/SMTP connection management
  config/        # Config loading and schema validation
  safety/        # Audit logging, rate limiting, input validation
  types/         # Shared TypeScript interfaces
  resources/     # MCP resource definitions
  prompts/       # MCP prompt definitions
  cli/           # CLI commands (setup, install, etc.)
  utils/         # Calendar/meeting URL helpers
```

## Key Patterns

### Tool Registration
- All tools registered in `src/tools/register.ts`
- Read tools always registered; write tools skipped when `readOnly=true`
- Each tool file exports a `registerXxxTools(server, imapService)` function
- Tools use Zod schemas for input validation and `audit.log()` for audit trails

### IMAP Operations
- `ImapService` in `src/services/imap.service.ts` contains all IMAP logic
- Operations use mailbox locks (`client.getMailboxLock()`) for concurrency safety
- Special-use mailbox resolution: `mailboxes.find(mb => mb.specialUse === '\\Archive')` etc.
- Virtual folders (`\All`, `\Flagged`) are rejected via `assertRealMailbox()`
- Message IDs are IMAP UIDs (integers); single-message tools accept string IDs, bulk tools accept numeric UID arrays

### Bulk Operations
- `BulkResult` type: `{ total, succeeded, failed, errors? }`
- UID ranges built as comma-separated strings: `ids.join(',')`
- Max 100 IDs per bulk call

### Input Sanitization
- `sanitizeMailboxName()` rejects IMAP wildcards (`*`, `%`)
- `sanitizeSearchQuery()` strips control characters

## Commands

- `npm run check` - Biome format check + ESLint
- `npx vitest run` - Run all unit tests
- `npx tsc --noEmit` - Type check
- Integration tests: `npx vitest run -c vitest.config.integration.ts` (requires IMAP server)
