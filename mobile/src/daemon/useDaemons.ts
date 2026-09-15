/**
 * The paired machines, for the two screens that mention them.
 *
 * Home needs them to know whether the work somebody approved has anywhere to
 * go; Settings needs them to say something true on its row. Both ask on
 * focus, both ask for nothing at all when the daemon is switched off, and a
 * failure leaves the list as it was rather than claiming there are none —
 * "no machines" and "we could not ask" are different answers, and only one of
 * them should ever produce a banner.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { daemonsApi, type Daemon } from '../api/daemons';
import { useFeatures } from '../home/features';
import { offersPairing } from './model';

export interface Machines {
  daemons: Daemon[];
  /** True until the first answer, so nothing is decided from an empty list. */
  loading: boolean;
  reload: () => void;
}

export function useDaemons(): Machines {
  const enabled = offersPairing(useFeatures());
  const [daemons, setDaemons] = useState<Daemon[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void daemonsApi.list()
      .then(({ daemons: rows }) => setDaemons(rows))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [enabled]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return { daemons, loading, reload };
}
