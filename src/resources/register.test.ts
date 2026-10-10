import type { AppConfig } from '../types/index.js';
import registerAllResources from './register.js';

vi.mock('./accounts.resource.js', () => ({ default: vi.fn() }));
vi.mock('./mailboxes.resource.js', () => ({ default: vi.fn() }));
vi.mock('./scheduled.resource.js', () => ({ default: vi.fn() }));
vi.mock('./stats.resource.js', () => ({ default: vi.fn() }));
vi.mock('./templates.resource.js', () => ({ default: vi.fn() }));
vi.mock('./unread.resource.js', () => ({ default: vi.fn() }));

import registerAccountsResource from './accounts.resource.js';
import registerScheduledResource from './scheduled.resource.js';

function createConfig(schedulerEnabled: boolean): AppConfig {
  return {
    settings: {
      rateLimit: 10,
      readOnly: false,
      watcher: { enabled: false, folders: ['INBOX'], idleTimeout: 1740 },
      scheduler: { enabled: schedulerEnabled },
      hooks: {
        onNewEmail: 'notify',
        preset: 'priority-focus',
        autoLabel: false,
        autoFlag: false,
        batchDelay: 5,
        rules: [],
        alerts: {
          desktop: false,
          sound: false,
          urgencyThreshold: 'high',
          webhookUrl: '',
          webhookEvents: ['urgent', 'high'],
        },
      },
    },
    accounts: [],
  };
}

function register(config: AppConfig): void {
  registerAllResources({} as never, {} as never, {} as never, {} as never, {} as never, config);
}

describe('registerAllResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers email://scheduled when the scheduler is enabled', () => {
    register(createConfig(true));
    expect(registerAccountsResource).toHaveBeenCalled();
    expect(registerScheduledResource).toHaveBeenCalled();
  });

  it('skips email://scheduled when the scheduler is disabled', () => {
    register(createConfig(false));
    expect(registerAccountsResource).toHaveBeenCalled();
    expect(registerScheduledResource).not.toHaveBeenCalled();
  });
});
