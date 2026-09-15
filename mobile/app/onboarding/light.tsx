/**
 * The light — canvas O6: three states of one LED, and no legalese.
 *
 * This is the consent screen, and it is deliberately not a wall of terms.
 * The pendant tells the room what it is doing with a light anyone in that
 * room can see, so the honest way to ask for consent is to teach the light.
 * Three rows, each with the dot in the colour it actually glows, and one
 * button that says the person understood.
 *
 * The photograph the canvas calls for does not exist yet, so its place is a
 * dashed frame that says what belongs there rather than a stock image of
 * somebody else's product.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Label, Screen, TopRow, Txt } from '@/design/kit';
import { LIGHT, PAIR } from '@/design/copy';

/** How each state's dot is painted. The colours are the LED's own. */
const DOT: Record<'danger' | 'ring' | 'stamp', string> = {
  danger: 'bg-tone-danger',
  ring: 'border-[1.5px] border-tone-faint',
  stamp: 'bg-tone-stamp',
};

export default function LightScreen() {
  const router = useRouter();

  return (
    <Screen edges={['top']}>
      <TopRow back={PAIR.next} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-[26px] pt-[10px]">
          <Txt variant="title">{LIGHT.title}</Txt>
        </View>

        {/* The product shot that has not been taken. Named, not faked. */}
        <View className="px-[26px] mt-[16px]">
          <Card variant="dashed" pad="none" className="h-[210px] items-center justify-center">
            {LIGHT.photo.map((line) => (
              <Label key={line} variant="eyebrow" tone="faint">{line}</Label>
            ))}
            <Label variant="eyebrow" tone="faint" className="mt-[8px]">{LIGHT.photoNote}</Label>
          </Card>
        </View>

        <View className="px-[26px] mt-[16px] gap-[9px]">
          {LIGHT.states.map((state) => (
            <Card key={state.title}>
              <View className="flex-row gap-[12px]">
                <View className={`w-[10px] h-[10px] rounded-full mt-[5px] ${DOT[state.dot]}`} />
                <View className="flex-1">
                  <Txt variant="strong">{state.title}</Txt>
                  <Txt variant="small" tone="muted" className="mt-[3px]">{state.line}</Txt>
                </View>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>

      <View className="px-[26px] pb-[34px] pt-[18px]">
        <Button
          title={LIGHT.understood}
          onPress={() => router.push('/onboarding/ready')}
          full
        />
      </View>
    </Screen>
  );
}
