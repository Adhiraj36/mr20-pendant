/**
 * What a `402` looks like — canvas U1, in the shape a sheet can hold.
 *
 * `POST /tasks/:id/approve` answers `402` and not `403` because the second
 * gate is a price (T3b), so the app's answer to it is an offer rather than an
 * error. The price, the tier names and the feature list are remote
 * configuration and belong to the chooser (T6's `onboarding/plan`); this
 * says what it knows, names nothing it would have to invent, and hands over.
 */
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Sheet, Txt, Button, Icon } from '../design/kit';
import { UNLOCK_COPY } from '../design/copy';

export function UnlockSheet({
  visible, onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={UNLOCK_COPY.title}
      icon={Icon.ArrowUpRight}
      context={UNLOCK_COPY.statement}
    >
      <View className="gap-[12px] py-[18px] px-[20px]">
        <Txt variant="bodyL" tone="muted">{UNLOCK_COPY.line}</Txt>
        <Button
          full
          title={UNLOCK_COPY.action}
          onPress={() => {
            onClose();
            router.push('/onboarding/plan');
          }}
        />
        <Button full variant="ghost" title={UNLOCK_COPY.dismiss} onPress={onClose} />
      </View>
    </Sheet>
  );
}
