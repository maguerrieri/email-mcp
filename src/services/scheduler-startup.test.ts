import { mcpLog } from '../logging.js';
import type SchedulerService from './scheduler.service.js';
import startScheduler, { SCHEDULER_INTERVAL_MS } from './scheduler-startup.js';

vi.mock('../logging.js', () => ({
  mcpLog: vi.fn().mockResolvedValue(undefined),
}));

function createScheduler(pending: unknown[] = []) {
  return {
    checkAndSend: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
    list: vi.fn().mockResolvedValue(pending),
  };
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks the queue on start and every interval when enabled', async () => {
    const scheduler = createScheduler();
    const stop = await startScheduler(scheduler as unknown as SchedulerService, true);

    expect(scheduler.checkAndSend).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SCHEDULER_INTERVAL_MS);
    expect(scheduler.checkAndSend).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(SCHEDULER_INTERVAL_MS * 3);
    expect(scheduler.checkAndSend).toHaveBeenCalledTimes(2);
  });

  it('sends nothing and starts no timer when disabled', async () => {
    const scheduler = createScheduler();
    await startScheduler(scheduler as unknown as SchedulerService, false);

    await vi.advanceTimersByTimeAsync(SCHEDULER_INTERVAL_MS * 3);
    expect(scheduler.checkAndSend).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(mcpLog).not.toHaveBeenCalled();
  });

  it('warns about emails still queued when disabled', async () => {
    const scheduler = createScheduler([{ id: 'a' }, { id: 'b' }]);
    await startScheduler(scheduler as unknown as SchedulerService, false);

    expect(scheduler.list).toHaveBeenCalledWith({ status: 'pending' });
    expect(scheduler.checkAndSend).not.toHaveBeenCalled();
    expect(mcpLog).toHaveBeenCalledWith(
      'warning',
      'scheduler',
      expect.stringContaining('2 queued email(s)'),
    );
  });
});
