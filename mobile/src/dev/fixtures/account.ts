/**
 * The account, as a set of canned API answers: the device, the plan, the
 * tasks and the receipts.
 *
 * The other fixture files in this directory seed the **store** — they are
 * what a screenshot pass calls to put the app in a particular state. These
 * are resolvers, which is the other half: they answer the requests a screen
 * makes on its own, so a screen fetched from `GET /tasks` on mount shows
 * something without a backend, a session or a pendant in the room.
 *
 * Development only, and only when `lyzn.fixtures` is on. A resolver that
 * does not recognise a route returns `undefined` and the real request goes
 * out, so this covers what it covers and lies about nothing else.
 */
import { DEFAULT_APP_CONFIG } from '../../plan/config';
import { FIXTURE_TASKS, FIXTURE_RECEIPTS } from './tasks';

/** The pendant the canvas draws: YLF20, 36 %, 1.4 GB of 8 used, firmware 1.2.0. */
const DEVICE = {
  mac: 'f0:13:d8:30:aa:21',
  peripheralId: 'FIXTURE-PERIPHERAL',
  name: 'YLF20_D830',
  firmware: '1.2.0',
  batteryPercent: 36,
  freeMb: 6758,
  totalMb: 8192,
  lastSeenAt: new Date().toISOString(),
  pairedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

/** Strips the query string: a resolver matches on the path, not the filter. */
const routeOf = (path: string) => path.split('?')[0] ?? path;

export function accountFixtures(method: string, path: string): unknown | undefined {
  const route = routeOf(path);

  if (method === 'GET' && route === '/devices') return { devices: [DEVICE] };
  if (method === 'PATCH' && route.startsWith('/devices/')) return {};

  // No plan: the chooser is what a fresh account should be looking at, and
  // `seedPaidPlan()` is how a pass asks for the other side of it.
  if (method === 'GET' && route === '/plan') {
    return { plan: 'none', automation: false, status: 'none' };
  }

  if (method === 'GET' && route === '/config') return DEFAULT_APP_CONFIG;

  if (method === 'GET' && route === '/tasks') {
    return { tasks: FIXTURE_TASKS.map((task) => ({ ...task })) };
  }
  if (method === 'GET' && route === '/receipts') {
    return {
      receipts: FIXTURE_RECEIPTS.map((receipt) => ({
        ...receipt,
        rows: receipt.rows.map((row) => ({ ...row })),
      })),
    };
  }
  if (method === 'GET' && route.startsWith('/receipts/')) {
    const id = route.slice('/receipts/'.length);
    const found = FIXTURE_RECEIPTS.find((receipt) => receipt.receiptId === id);
    return found ? { receipt: { ...found, rows: found.rows.map((row) => ({ ...row })) } } : undefined;
  }

  // Marking a task done prints its receipt, which is the whole point of the
  // gesture — so the fixture returns both, exactly as the API does.
  if (method === 'POST' && /^\/tasks\/[^/]+\/done$/.test(route)) {
    const id = route.split('/')[2] ?? '';
    const task = FIXTURE_TASKS.find((candidate) => candidate.taskId === id);
    if (!task) return undefined;
    const done = { ...task, status: 'done' as const, doneAt: new Date().toISOString() };
    return { task: done, receipt: FIXTURE_RECEIPTS[0] };
  }
  if (method === 'POST' && /^\/tasks\/[^/]+\/dismiss$/.test(route)) {
    const id = route.split('/')[2] ?? '';
    const task = FIXTURE_TASKS.find((candidate) => candidate.taskId === id);
    return task ? { task: { ...task, status: 'dismissed' as const } } : undefined;
  }

  if (method === 'GET' && route === '/categories') {
    return {
      categories: [
        { id: 'cat-work', name: 'Work' },
        { id: 'cat-family', name: 'Family' },
        { id: 'cat-vendors', name: 'Vendors' },
      ],
    };
  }

  if (method === 'GET' && route === '/profile') {
    return { name: 'Nikhil' };
  }

  return undefined;
}
