/**
 * The remote configuration, without the network.
 *
 * The defaults in `plan/config.ts` are already the backend's seeded
 * document, so a fixture that only repeated them would prove nothing. This
 * one differs in exactly the way the screenshots need: **the flags are on**,
 * so the screens that are hidden in production — the approval gates in
 * onboarding and in settings, the daemon row — can be photographed against
 * the canvas they were drawn from.
 *
 * That is also the honest reading of "flag-gated, off": the screens exist,
 * the product behind them does not, and the flags are what stands between
 * them. A fixture that flips the flags is testing the gate, not defeating it.
 */
import { useApp } from '../../state/store';
import { DEFAULT_APP_CONFIG } from '../../plan/config';

export async function seedConfigFixtures(): Promise<void> {
  useApp.setState({
    appConfig: {
      ...DEFAULT_APP_CONFIG,
      version: 999,
      updatedAt: new Date().toISOString(),
      features: {
        ...DEFAULT_APP_CONFIG.features,
        // Off in production; on here so O5 and the settings rows that need
        // them can be seen. Nothing behind these is real.
        daemon: true,
        execution: true,
        whatsapp: false,
      },
    },
  });
}
