import type { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConnectionManager from './manager.js';
import type { AccountConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Controllable ImapFlow mock — a real EventEmitter exposing only the surface
// ConnectionManager touches, so we can drive 'error'/usable transitions.
// Shared state goes through vi.hoisted so it exists before the hoisted vi.mock
// factory runs; the class itself is defined inside the factory to avoid a TDZ
// reference.
// ---------------------------------------------------------------------------

type FakeClient = EventEmitter & { usable: boolean };

const { imapInstances } = vi.hoisted(() => ({ imapInstances: [] as FakeClient[] }));

vi.mock('imapflow', async () => {
  const { EventEmitter: EE } = await import('node:events');
  class MockImapFlow extends EE {
    usable = true;

    connect = vi.fn().mockResolvedValue(undefined);

    close = vi.fn();

    logout = vi.fn().mockResolvedValue(undefined);

    constructor() {
      super();
      imapInstances.push(this as unknown as FakeClient);
    }
  }
  return { ImapFlow: MockImapFlow };
});

function makeAccount(name = 'test'): AccountConfig {
  return {
    name,
    email: `${name}@example.com`,
    username: `${name}@example.com`,
    password: 'secret',
    imap: { host: 'imap.example.com', port: 993, tls: true, starttls: false, verifySsl: true },
    smtp: { host: 'smtp.example.com', port: 587, tls: false, starttls: true, verifySsl: true },
  };
}

describe('ConnectionManager IMAP pooling', () => {
  beforeEach(() => {
    imapInstances.length = 0;
  });

  it('reuses a usable pooled client across calls', async () => {
    const manager = new ConnectionManager([makeAccount()]);
    const first = await manager.getImapClient('test');
    const second = await manager.getImapClient('test');

    expect(first).toBe(second);
    expect(imapInstances).toHaveLength(1);
  });

  it("attaches an 'error' listener so a socket reset does not crash the process", async () => {
    const manager = new ConnectionManager([makeAccount()]);
    const client = (await manager.getImapClient('test')) as unknown as FakeClient;

    // Before the fix this client had no 'error' listener, so Node would re-throw
    // the event and crash the process. Emitting must now be a no-op (bar logging).
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    expect(() => client.emit('error', new Error('write ECONNRESET'))).not.toThrow();
  });

  it('evicts the dead client after an error so the next call reconnects', async () => {
    const manager = new ConnectionManager([makeAccount()]);
    const first = (await manager.getImapClient('test')) as unknown as FakeClient;

    // Simulate the server resetting the idle socket. The mock stays usable:true,
    // so the only thing that can force a reconnect is the error handler evicting
    // the dead client from the pool — i.e. this asserts the fix, not the
    // pre-existing `usable` staleness check.
    first.emit('error', new Error('write ECONNRESET'));

    const second = await manager.getImapClient('test');
    expect(second).not.toBe(first as unknown);
    expect(imapInstances).toHaveLength(2);
  });
});
