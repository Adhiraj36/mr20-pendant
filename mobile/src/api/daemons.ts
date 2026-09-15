/**
 * The laptop daemon, as the app talks to it.
 *
 * Three calls, and the app only ever makes these three. Everything else in
 * `backend/docs/daemon-api.md` — the heartbeat, the work poll, the claim, the
 * result — belongs to the machine and carries the machine's own bearer token,
 * which the phone never sees. The phone's whole job is to hand out an
 * invitation and to be able to take it back.
 *
 * `POST /daemons/code` is behind the automation price and answers `402` when
 * it is not paid, which is not a failure to show: it is the plan chooser
 * (`isPaymentRequired`, shared with tasks for exactly this reason).
 * Listing and unpairing are deliberately not behind that gate — a person
 * whose plan lapsed still owns the laptop they paired.
 */
import { request } from './client';

/** What the daemon last said about itself, which is not the same as the truth. */
export type DaemonStatus = 'online' | 'busy' | 'offline';

/** One paired machine, as `GET /daemons` answers. */
export interface Daemon {
  daemonId: string;
  userId: string;
  /** What the person calls this machine. Falls back to the hostname. */
  name: string;
  hostname?: string;
  os?: string;
  version?: string;
  status: DaemonStatus;
  /** The loops this build found. Advisory: work is handed out by task status. */
  capabilities: string[];
  lastHeartbeatAt?: string;
  registeredAt: string;
  /**
   * The server's reading of the clock rather than the daemon's word — a
   * laptop whose lid closed never got to say "offline".
   */
  online: boolean;
}

/** The six characters, and how long they are worth typing. */
export interface PairCode {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export const daemonsApi = {
  list: () => request<{ daemons: Daemon[] }>('GET', '/daemons'),

  /** `402` until execution is on **and** the plan carries automation. */
  mintCode: () => request<PairCode>('POST', '/daemons/code'),

  /**
   * Revocation. Deleting the row is the whole of it: the machine's token has
   * nothing left to resolve to on its very next request.
   */
  unpair: (id: string) => request<void>('DELETE', `/daemons/${encodeURIComponent(id)}`),
};
