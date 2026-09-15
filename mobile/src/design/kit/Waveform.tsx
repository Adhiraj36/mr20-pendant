/**
 * The waveform, in the canvas' colour.
 *
 * The bars themselves are `stage/Waveform` — the site's own twelve, ported,
 * and the only thing in the app that loops without a cause while audio is
 * live. The kit's job here is one default: on the canvas a live waveform is
 * always **void red**, because the pendant's light is red and the two say the
 * same thing (C1, H1, P1). Screens that are not rebuilt yet keep the muted
 * bars they have, which is why the default lives here and not there.
 */
import React from 'react';
import { Waveform as StageWaveform, type WaveformTone } from '../stage/Waveform';

export type { WaveformTone };

type StageProps = React.ComponentProps<typeof StageWaveform>;

export function Waveform({ tone = 'danger', ...rest }: StageProps) {
  return <StageWaveform tone={tone} {...rest} />;
}
