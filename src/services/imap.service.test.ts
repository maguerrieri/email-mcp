import type { IConnectionManager } from '../connections/types.js';
import ImapService from './imap.service.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockImapClient() {
  const releaseFn = vi.fn();
  return {
    usable: true,
    getMailboxLock: vi.fn().mockResolvedValue({ release: releaseFn }),
    list: vi.fn().mockResolvedValue([]),
    status: vi.fn().mockResolvedValue({ messages: 5, unseen: 2 }),
    fetch: vi.fn().mockReturnValue((async function* fetchMock() {})()),
    fetchOne: vi.fn().mockResolvedValue(null),
    download: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue([]),
    messageMove: vi.fn().mockResolvedValue(true),
    messageDelete: vi.fn().mockResolvedValue(true),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    _releaseFn: releaseFn,
  };
}

/** Helper to create a readable stream from a string. */
async function* toAsyncIterable(text: string) {
  yield Buffer.from(text);
}

function streamFrom(text: string) {
  return { content: toAsyncIterable(text) };
}

function createMockConnectionManager(mockClient: ReturnType<typeof createMockImapClient>) {
  return {
    getAccount: vi.fn().mockReturnValue({
      name: 'test',
      email: 'test@example.com',
      username: 'test@example.com',
      imap: { host: 'imap.example.com', port: 993, tls: true, starttls: false, verifySsl: true },
      smtp: { host: 'smtp.example.com', port: 465, tls: true, starttls: false, verifySsl: true },
    }),
    getAccountNames: vi.fn().mockReturnValue(['test']),
    getImapClient: vi.fn().mockResolvedValue(mockClient),
    getSmtpTransport: vi.fn(),
    closeAll: vi.fn(),
  } satisfies IConnectionManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImapService', () => {
  let client: ReturnType<typeof createMockImapClient>;
  let connections: ReturnType<typeof createMockConnectionManager>;
  let service: ImapService;

  beforeEach(() => {
    client = createMockImapClient();
    connections = createMockConnectionManager(client);
    service = new ImapService(connections);
  });

  // -----------------------------------------------------------------------
  // listMailboxes
  // -----------------------------------------------------------------------

  describe('listMailboxes', () => {
    it('returns mailbox list with message counts', async () => {
      client.list.mockResolvedValue([
        { name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' },
        { name: 'Sent', path: 'Sent', specialUse: '\\Sent' },
      ]);
      client.status.mockResolvedValue({ messages: 10, unseen: 3 });

      const result = await service.listMailboxes('test');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'INBOX',
        path: 'INBOX',
        specialUse: '\\Inbox',
        totalMessages: 10,
        unseenMessages: 3,
      });
      expect(result[1]).toEqual({
        name: 'Sent',
        path: 'Sent',
        specialUse: '\\Sent',
        totalMessages: 10,
        unseenMessages: 3,
      });
      expect(client.status).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // moveEmail
  // -----------------------------------------------------------------------

  describe('moveEmail', () => {
    it('moves email between mailboxes', async () => {
      // assertRealMailbox calls client.list() internally
      client.list.mockResolvedValue([{ name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' }]);

      await service.moveEmail('test', '42', 'INBOX', 'Archive');

      expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX');
      expect(client.messageMove).toHaveBeenCalledWith('42', 'Archive', { uid: true });
      expect(client._releaseFn).toHaveBeenCalled();
    });

    it('calls sanitizeMailboxName on inputs', async () => {
      client.list.mockResolvedValue([]);

      // Passing valid names — sanitize should pass them through without error
      await service.moveEmail('test', '1', 'INBOX', 'Sent');

      expect(client.messageMove).toHaveBeenCalledWith('1', 'Sent', { uid: true });
    });
  });

  // -----------------------------------------------------------------------
  // deleteEmail
  // -----------------------------------------------------------------------

  describe('deleteEmail', () => {
    it('permanently deletes when permanent=true', async () => {
      await service.deleteEmail('test', '99', 'INBOX', true);

      expect(client.messageDelete).toHaveBeenCalledWith('99', { uid: true });
      expect(client.messageMove).not.toHaveBeenCalled();
      expect(client._releaseFn).toHaveBeenCalled();
    });

    it('moves to trash when permanent=false', async () => {
      // assertRealMailbox + trash detection both call client.list()
      client.list.mockResolvedValue([
        { name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' },
        { name: 'Trash', path: 'Trash', specialUse: '\\Trash' },
      ]);

      await service.deleteEmail('test', '99', 'INBOX', false);

      expect(client.messageDelete).not.toHaveBeenCalled();
      expect(client.messageMove).toHaveBeenCalledWith('99', 'Trash', { uid: true });
      expect(client._releaseFn).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // archiveEmails
  // -----------------------------------------------------------------------

  describe('archiveEmails', () => {
    it('resolves archive mailbox via specialUse and moves emails', async () => {
      client.list.mockResolvedValue([
        { name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' },
        { name: 'Archive', path: 'Archive', specialUse: '\\Archive' },
      ]);

      const result = await service.archiveEmails('test', [1, 2, 3], 'INBOX');

      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(client.messageMove).toHaveBeenCalledWith('1,2,3', 'Archive', { uid: true });
      expect(client._releaseFn).toHaveBeenCalled();
    });

    it('falls back to "Archive" when no specialUse mailbox exists', async () => {
      client.list.mockResolvedValue([{ name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' }]);

      await service.archiveEmails('test', [10], 'INBOX');

      expect(client.messageMove).toHaveBeenCalledWith('10', 'Archive', { uid: true });
    });

    it('uses provider-specific archive path from specialUse', async () => {
      client.list.mockResolvedValue([
        { name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' },
        { name: 'All Mail', path: '[Gmail]/All Mail', specialUse: '\\Archive' },
      ]);

      await service.archiveEmails('test', [5], 'INBOX');

      expect(client.messageMove).toHaveBeenCalledWith('5', '[Gmail]/All Mail', { uid: true });
    });

    it('reports failure when messageMove is rejected', async () => {
      client.list.mockResolvedValue([{ name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' }]);
      client.messageMove.mockResolvedValue(false);

      const result = await service.archiveEmails('test', [1, 2], 'INBOX');

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.errors).toEqual(['IMAP server rejected the move to Archive.']);
      expect(client._releaseFn).toHaveBeenCalled();
    });

    it('releases lock on error', async () => {
      client.list.mockResolvedValue([{ name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' }]);
      client.messageMove.mockRejectedValue(new Error('Connection lost'));

      const result = await service.archiveEmails('test', [1], 'INBOX');

      expect(result.failed).toBe(1);
      expect(result.errors).toEqual(['Connection lost']);
      expect(client._releaseFn).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // setFlags
  // -----------------------------------------------------------------------

  describe('setFlags', () => {
    it('adds Seen flag for read action', async () => {
      await service.setFlags('test', '10', 'INBOX', 'read');

      expect(client.messageFlagsAdd).toHaveBeenCalledWith('10', ['\\Seen'], { uid: true });
      expect(client.messageFlagsRemove).not.toHaveBeenCalled();
    });

    it('removes Seen flag for unread action', async () => {
      await service.setFlags('test', '10', 'INBOX', 'unread');

      expect(client.messageFlagsRemove).toHaveBeenCalledWith('10', ['\\Seen'], { uid: true });
      expect(client.messageFlagsAdd).not.toHaveBeenCalled();
    });

    it('adds Flagged flag for flag action', async () => {
      await service.setFlags('test', '10', 'INBOX', 'flag');

      expect(client.messageFlagsAdd).toHaveBeenCalledWith('10', ['\\Flagged'], { uid: true });
    });
  });

  // -----------------------------------------------------------------------
  // getEmail — multipart body extraction
  // -----------------------------------------------------------------------

  describe('getEmail', () => {
    const baseEnvelope = {
      from: [{ name: 'Sender', address: 'sender@example.com' }],
      to: [{ name: 'Recipient', address: 'recipient@example.com' }],
      subject: 'Test Subject',
      date: '2026-01-01T00:00:00Z',
      messageId: '<msg-1@example.com>',
    };

    it('extracts HTML body from multipart/alternative via bodyStructure', async () => {
      client.fetchOne.mockResolvedValue({
        uid: 1,
        envelope: baseEnvelope,
        flags: new Set(),
        bodyStructure: {
          type: 'multipart/alternative',
          childNodes: [
            { type: 'text/plain', part: '1' },
            { type: 'text/html', part: '2' },
          ],
        },
        source: Buffer.from('Subject: Test\r\n\r\nplain body'),
      });

      client.download
        .mockResolvedValueOnce(streamFrom('plain text content'))
        .mockResolvedValueOnce(streamFrom('<h1>HTML content</h1>'));

      const email = await service.getEmail('test', '1', 'INBOX');

      expect(email.bodyText).toBe('plain text content');
      expect(email.bodyHtml).toBe('<h1>HTML content</h1>');
      // First download call is for part '1' (text/plain), second for part '2' (text/html)
      expect(client.download).toHaveBeenCalledWith('1', '2', { uid: true });
    });

    it('extracts HTML from nested multipart/mixed > multipart/alternative', async () => {
      client.fetchOne.mockResolvedValue({
        uid: 2,
        envelope: baseEnvelope,
        flags: new Set(),
        bodyStructure: {
          type: 'multipart/mixed',
          childNodes: [
            {
              type: 'multipart/alternative',
              childNodes: [
                { type: 'text/plain', part: '1.1' },
                { type: 'text/html', part: '1.2' },
              ],
            },
            { type: 'application/pdf', part: '2', disposition: 'attachment' },
          ],
        },
        source: Buffer.from('Subject: Test\r\n\r\nplain body'),
      });

      client.download
        .mockResolvedValueOnce(streamFrom('plain text'))
        .mockResolvedValueOnce(streamFrom('<p>Rich HTML</p>'));

      const email = await service.getEmail('test', '2', 'INBOX');

      expect(email.bodyHtml).toBe('<p>Rich HTML</p>');
      expect(client.download).toHaveBeenCalledWith('2', '1.2', { uid: true });
    });

    it('computes part path when bodyStructure nodes lack part field', async () => {
      client.fetchOne.mockResolvedValue({
        uid: 3,
        envelope: baseEnvelope,
        flags: new Set(),
        bodyStructure: {
          type: 'multipart/alternative',
          childNodes: [{ type: 'text/plain' }, { type: 'text/html' }],
        },
        source: Buffer.from('Subject: Test\r\n\r\nplain body'),
      });

      client.download
        .mockResolvedValueOnce(streamFrom('plain'))
        .mockResolvedValueOnce(streamFrom('<b>html</b>'));

      const email = await service.getEmail('test', '3', 'INBOX');

      expect(email.bodyHtml).toBe('<b>html</b>');
      // Without part fields, the path should be computed as '2' (second child)
      expect(client.download).toHaveBeenCalledWith('3', '2', { uid: true });
    });

    it('leaves bodyHtml undefined when no text/html part exists', async () => {
      client.fetchOne.mockResolvedValue({
        uid: 4,
        envelope: baseEnvelope,
        flags: new Set(),
        bodyStructure: {
          type: 'text/plain',
          part: '1',
        },
        source: Buffer.from('Subject: Test\r\n\r\nplain only'),
      });

      client.download.mockResolvedValueOnce(streamFrom('just plain text'));

      const email = await service.getEmail('test', '4', 'INBOX');

      expect(email.bodyText).toBe('just plain text');
      expect(email.bodyHtml).toBeUndefined();
    });
  });
});
