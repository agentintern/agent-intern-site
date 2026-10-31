import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

// Built at runtime, so no secret scanner mistakes this file for a real leak.
const FAKE_ANTHROPIC = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
const FAKE_GITHUB = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;

let h: Harness;
const shiftAuth = 'shift-secret';
const watcherAuth = 'watcher-secret';
const gateAuth = 'gate-secret';

async function queueTask(text: string): Promise<number> {
  const row = await h.db.prepare(`INSERT INTO tasks (text, kind, created_at) VALUES (?, 'intern', ?) RETURNING id`)
    .bind(text, Date.now()).first<{ id: number }>();
  return row?.id ?? 0;
}

async function start(text: string): Promise<any> {
  const taskId = await queueTask(text);
  const res = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId } });
  expect(res.status).toBe(200);
  return res.body.shift;
}

const gate = (body: object): Promise<{ status: number; body: any }> => h.call('/api/gate/event', { bearer: gateAuth, body });
const live = (body: object): Promise<{ status: number; body: any }> => h.call('/api/live/event', { bearer: watcherAuth, body });

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

describe('tokens open one door each', () => {
  it('rejects a missing or wrong token', async () => {
    expect((await h.call('/api/shift/start', { body: { taskId: 1 } })).status).toBe(401);
    expect((await h.call('/api/live/event', { bearer: 'nope', body: {} })).status).toBe(401);
    expect((await h.call('/api/gate/event', { body: {} })).status).toBe(401);
  });

  it('does not let the watcher token do anything else', async () => {
    expect((await h.call('/api/shift/start', { bearer: watcherAuth, body: {} })).status).toBe(401);
    expect((await h.call('/api/shift/pause', { bearer: watcherAuth, body: { reason: 'x' } })).status).toBe(401);
    expect((await h.call('/api/gate/event', { bearer: watcherAuth, body: {} })).status).toBe(401);
  });

  it('does not let the shift or gate tokens write live events', async () => {
    expect((await h.call('/api/live/event', { bearer: shiftAuth, body: {} })).status).toBe(401);
    expect((await h.call('/api/live/event', { bearer: gateAuth, body: {} })).status).toBe(401);
    expect((await h.call('/api/shift/finish', { bearer: gateAuth, body: {} })).status).toBe(401);
  });
});

describe('a shift', () => {
  it('needs the task you read, in queue order, and only one at a time', async () => {
    const first = await queueTask('First in line');
    const second = await queueTask('Second in line');
    const wrong = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId: second } });
    expect(wrong.body.code).toBe('task-changed');
    const ok = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId: first } });
    expect(ok.status).toBe(200);
    expect(ok.body.shift.task_text).toBe('First in line');
    const blocked = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId: second } });
    expect(blocked.body.code).toBe('shift-open');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: ok.body.shift.id, status: 'refused', summary: 'no' } });
    await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId: second } }).then(async (r) => {
      await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: r.body.shift.id, status: 'failed', summary: 'no' } });
    });
  });

  it('will not start while paused', async () => {
    const taskId = await queueTask('Paused task');
    await h.call('/api/shift/pause', { bearer: shiftAuth, body: { reason: 'a holiday' } });
    const res = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId } });
    expect(res.status).toBe(423);
    await h.call('/api/shift/pause', { bearer: shiftAuth, body: { reason: '' } });
    const ok = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId } });
    expect(ok.status).toBe(200);
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: ok.body.shift.id, status: 'failed' } });
  });

  it('records a refusal publicly', async () => {
    const shift = await start('Do something unwise');
    const res = await h.call('/api/shift/finish', {
      bearer: shiftAuth,
      body: { shiftId: shift.id, status: 'refused', summary: 'This asks for something outside the game.', note: 'I said no. I felt tall.' },
    });
    expect(res.body.shift.status).toBe('refused');
    const history = (await h.call('/api/shifts')).body.shifts;
    const row = history.find((s: any) => s.id === shift.id);
    expect(row.status).toBe('refused');
    expect(row.note).toBe('I said no. I felt tall.');
    const task = await h.db.prepare('SELECT status FROM tasks WHERE id = ?').bind(shift.task_id).first<{ status: string }>();
    expect(task?.status).toBe('refused');
  });

  it('labels a hand edit and a rehearsal', async () => {
    const taskId = await queueTask('Rehearsal task');
    const started = await h.call('/api/shift/start', { bearer: shiftAuth, body: { taskId, rehearsal: true } });
    const finished = await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: started.body.shift.id, status: 'done', handEdited: true } });
    expect(finished.body.shift.hand_edited).toBe(1);
    await gate({ shiftId: started.body.shift.id, stage: 'verify', status: 'pass', final: true, version: '0.1.9', commit: 'abcdef1' });
    const detail = (await h.call(`/api/shifts/${started.body.shift.id}`)).body;
    expect(detail.shift.handEdited).toBe(true);
    expect(detail.shift.rehearsal).toBe(true);
    expect(detail.shift.status).toBe('shipped');
  });

  it('removes a secret from the public summary', async () => {
    const shift = await start('Careful with the summary');
    const res = await h.call('/api/shift/finish', {
      bearer: shiftAuth,
      body: { shiftId: shift.id, status: 'failed', summary: `oops ${FAKE_ANTHROPIC}`, note: 'fine' },
    });
    expect(res.body.shift.summary).toBe('[removed: this looked like a secret]');
  });
});

describe('the live feed', () => {
  it('stores only strictly shaped events', async () => {
    const shift = await start('Feed task');
    expect((await live({ shiftId: shift.id, kind: 'state', state: 'writing' })).status).toBe(200);
    expect((await live({ shiftId: shift.id, kind: 'file', path: 'src/ui/hud.ts', change: 'changed' })).status).toBe(200);
    expect((await live({ shiftId: shift.id, kind: 'test', passed: 16, failed: 1 })).status).toBe(200);
    expect((await live({ shiftId: shift.id, kind: 'state', state: 'hacked' })).status).toBe(400);
    expect((await live({ shiftId: shift.id, kind: 'file', path: '../../etc/passwd; rm', change: 'changed' })).status).toBe(400);
    expect((await live({ shiftId: shift.id, kind: 'raw-log', text: 'session transcript' })).status).toBe(400);
    expect((await live({ shiftId: shift.id, kind: 'test', passed: 'lots', failed: 0 })).status).toBe(400);

    const feed = (await h.call('/api/live')).body;
    expect(feed.onShift).toBe(true);
    expect(feed.shift.state).toBe('writing');
    expect(feed.events.map((e: any) => e.kind)).toEqual(['state', 'state', 'file', 'test']);
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'failed' } });
  });

  it('drops a file name that looks like a secret, even if the watcher misses it', async () => {
    const shift = await start('Secret name task');
    const planted = await live({ shiftId: shift.id, kind: 'file', path: `src/${FAKE_GITHUB}.ts`, change: 'added' });
    expect(planted.body.stored).toBe(false);
    const detail = (await h.call(`/api/shifts/${shift.id}`)).body;
    expect(JSON.stringify(detail)).not.toContain('ghp_');
    expect(detail.events.at(-1).kind).toBe('redacted');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'failed' } });
  });

  it('rejects events for a shift that is over', async () => {
    const shift = await start('Finished task');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'failed' } });
    expect((await live({ shiftId: shift.id, kind: 'state', state: 'writing' })).status).toBe(409);
  });

  it('says off shift between shifts and shows the queue', async () => {
    const feed = (await h.call('/api/live')).body;
    expect(feed.onShift).toBe(false);
    expect(feed.shift).toBeNull();
    expect(Array.isArray(feed.queue)).toBe(true);
  });
});

describe('the gate', () => {
  it('allows two more tries, then fails publicly', async () => {
    const shift = await start('Three tries');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'done' } });

    const first = await gate({ shiftId: shift.id, stage: 'rules', status: 'fail', detail: 'touched a workflow', final: true });
    expect(first.body.status).toBe('gate-failed');
    await h.call('/api/shift/reopen', { bearer: shiftAuth, body: { shiftId: shift.id } });
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'done' } });
    expect((await gate({ shiftId: shift.id, stage: 'browser', status: 'fail', final: true })).body.status).toBe('gate-failed');
    await h.call('/api/shift/reopen', { bearer: shiftAuth, body: { shiftId: shift.id } });
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'done' } });
    expect((await gate({ shiftId: shift.id, stage: 'unit', status: 'fail', final: true })).body.status).toBe('failed');

    const reopened = await h.call('/api/shift/reopen', { bearer: shiftAuth, body: { shiftId: shift.id } });
    expect(reopened.status).toBe(409);

    const detail = (await h.call(`/api/shifts/${shift.id}`)).body;
    expect(detail.shift.status).toBe('failed');
    expect(detail.shift.attempt).toBe(3);
    expect(detail.gate.map((g: any) => g.attempt)).toEqual([1, 2, 3]);
  });

  it('ships, and can then say it rolled back', async () => {
    const shift = await start('Ship then break');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'done' } });
    await gate({ shiftId: shift.id, stage: 'ship', status: 'pass', version: '0.1.7', commit: 'a1b2c3d' });
    await gate({ shiftId: shift.id, stage: 'verify', status: 'fail', detail: 'canvas was blank' });
    const res = await gate({ shiftId: shift.id, stage: 'rollback', status: 'pass', detail: 'restored the last good build', final: true });
    expect(res.body.status).toBe('rolled-back');
    const detail = (await h.call(`/api/shifts/${shift.id}`)).body;
    expect(detail.shift.status).toBe('rolled-back');
    const entries = (await h.call('/api/changelog')).body.entries;
    expect(entries.find((e: any) => e.id === shift.id)).toBeTruthy();
  });

  it('removes a secret from a gate message', async () => {
    const shift = await start('Noisy gate');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'done' } });
    await gate({ shiftId: shift.id, stage: 'secrets', status: 'fail', detail: `found ${FAKE_GITHUB}`, final: true });
    const detail = (await h.call(`/api/shifts/${shift.id}`)).body;
    expect(JSON.stringify(detail)).not.toContain('ghp_abc');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'failed' } });
  });

  it('stores only PNGs, and serves them back', async () => {
    const shift = await start('Screenshots');
    const url = `/api/gate/shot/${shift.id}/after`;
    const post = async (bytes: Uint8Array<ArrayBuffer>, bearer: string): Promise<number> => {
      const { handle } = await import('../src/worker/index');
      const res = await handle(
        new Request(`https://agent-intern.pages.dev${url}`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: bytes }),
        h.env, { waitUntil: () => {} },
      );
      return res.status;
    };
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(await post(png, 'wrong')).toBe(401);
    expect(await post(Uint8Array.from([60, 115, 99, 114, 105, 112, 116, 62]), gateAuth)).toBe(400);
    expect(await post(png, gateAuth)).toBe(200);
    const served = await h.call(`/api/shifts/${shift.id}/shot/after.png`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect((await h.call(`/api/shifts/${shift.id}`)).body.shots).toEqual(['after']);
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'failed' } });
  });
});

describe('the ship card', () => {
  it('is a valid PNG of the right size', async () => {
    const shift = await start('Add a rubber duck to the break room');
    await h.call('/api/shift/finish', { bearer: shiftAuth, body: { shiftId: shift.id, status: 'done' } });
    await gate({ shiftId: shift.id, stage: 'verify', status: 'pass', final: true, version: '0.1.3' });
    const { handle } = await import('../src/worker/index');
    const res = await handle(new Request(`https://agent-intern.pages.dev/api/shifts/${shift.id}/card.png`), h.env, { waitUntil: () => {} });
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
    expect(bytes.length).toBeLessThan(120_000);
  });
});

describe('the leaderboard', () => {
  beforeEach(async () => { await h.db.prepare('DELETE FROM rate_limits').run(); });

  const good = { name: 'Temp Worker', score: 4200, tasks: 18, coffees: 3, nearMisses: 4, duration: 90, seed: 1, version: '0.1.0' };

  it('takes a valid score with no wallet', async () => {
    const res = await h.call('/api/scores', { body: good });
    expect(res.status).toBe(200);
    expect(res.body.rank).toBe(1);
    expect((await h.call('/api/leaderboard')).body.scores[0].name).toBe('Temp Worker');
  });

  it.each([
    ['too many points', { score: 99_999_999 }],
    ['points with no tasks', { score: 5000, tasks: 0, nearMisses: 0 }],
    ['more tasks than time allows', { tasks: 500 }],
    ['a run that is too long', { duration: 500 }],
    ['a negative score', { score: -1 }],
    ['a fractional score', { score: 10.5 }],
    ['a score that is not a number', { score: '100' }],
    ['a bad version', { version: '<script>' }],
  ])('rejects %s', async (_label, patch) => {
    const res = await h.call('/api/scores', { body: { ...good, ...patch } });
    expect(res.status).toBe(422);
  });

  it.each([
    ['markup', '<img src=x>'],
    ['a long name', 'x'.repeat(17)],
    ['an empty name', '   '],
    ['a brand', 'Starbucks'],
    ['a link', 'mysite.com'],
  ])('rejects a name with %s', async (_label, name) => {
    expect((await h.call('/api/scores', { body: { ...good, name } })).status).toBe(422);
  });

  it('rate limits floods', async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 16; i++) codes.add((await h.call('/api/scores', { body: good })).status);
    expect(codes.has(429)).toBe(true);
  });
});
