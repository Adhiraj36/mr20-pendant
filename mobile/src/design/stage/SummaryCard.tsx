/**
 * The summary — app spec §3.4, a port of `web/src/components/Stage.tsx`'s
 * `SummaryCard`. `Panel` radius 20, padding 20; a `Label` eyebrow over
 * `body` text.
 */
import React, { type ReactNode } from 'react';
import { Panel, Label, Txt } from '../primitives';
import { space } from '../tokens';

export function SummaryCard({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <Panel style={{ gap: space.md }}>
      {eyebrow ? <Label>{eyebrow}</Label> : null}
      <Txt variant="body">{children}</Txt>
    </Panel>
  );
}
