/**
 * The offer to record with the phone, and the recording itself.
 *
 * One card, four states, because they are one thing in a person's head: I
 * have no pendant, so I press this, it counts, I press it again. It appears
 * only where a pendant would have been — the Pendant tab with nothing paired,
 * and Home with nothing recorded — so it never competes with the device it
 * stands in for.
 */
import React from 'react';
import { View } from 'react-native';
import { Button, Card, Label, RecordingPill, Txt } from '@/design/kit';
import { CAPTURE } from '@/design/copy';
import { nearingLimit } from './model';
import { usePhoneCapture } from './usePhoneCapture';

export function PhoneCaptureCard({ onFiled, className }: {
  /** Called when a recording has reached the account, so a list can refresh. */
  onFiled?: () => void;
  className?: string;
}) {
  const { capture, clock, start, stop, reset } = usePhoneCapture(onFiled);

  if (capture.state === 'recording' || capture.state === 'arming') {
    return (
      <View className={className}>
        <RecordingPill label={CAPTURE.recording} detail={clock} />
        {nearingLimit(capture.seconds) ? (
          <Label variant="tag" tone="danger" className="mt-[8px]">{CAPTURE.nearingLimit}</Label>
        ) : null}
        <Button
          title={CAPTURE.stop}
          variant="void"
          onPress={() => void stop()}
          busy={capture.state === 'arming'}
          className="mt-[12px]"
          full
        />
      </View>
    );
  }

  if (capture.state === 'saving') {
    return (
      <Card variant="carbon" pad="roomy" className={className}>
        <Label variant="tag">{CAPTURE.saving}</Label>
        <Txt variant="bodyL" tone="muted" className="mt-[8px]">{CAPTURE.savingLine}</Txt>
      </Card>
    );
  }

  if (capture.state === 'done') {
    return (
      <Card variant="carbon" pad="roomy" className={className}>
        <Label variant="tag" tone="settled">{CAPTURE.done}</Label>
        <Txt variant="bodyL" tone="muted" className="mt-[8px]">{CAPTURE.doneLine}</Txt>
        <Button title={CAPTURE.again} variant="secondary" onPress={reset} className="mt-[12px]" full />
      </Card>
    );
  }

  return (
    <Card variant="carbon" pad="roomy" className={className}>
      <Label variant="tag">{CAPTURE.eyebrow}</Label>
      <Txt variant="statement" className="mt-[6px]">{CAPTURE.statement}</Txt>
      <Txt variant="bodyL" tone="muted" className="mt-[9px]">{CAPTURE.line}</Txt>
      {/* A failure keeps the card, because the next thing to do is try again. */}
      {capture.state === 'failed' && capture.error ? (
        <Txt variant="small" tone="danger" className="mt-[9px]">{capture.error}</Txt>
      ) : null}
      <Button title={CAPTURE.start} onPress={() => void start()} className="mt-[14px]" full />
    </Card>
  );
}
