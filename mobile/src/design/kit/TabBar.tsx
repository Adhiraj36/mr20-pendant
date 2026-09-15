/**
 * The tab bar — canvas H1: `HOME · LYZN · PENDANT` on a paper strip, icons
 * at 22, labels mono 10 tracked .1em, the active one in ink.
 *
 * Drawn rather than taken from the platform, because the canvas' bar is a
 * strip of paper laid on the desk and UITabBar is a blurred system chrome
 * that would be the one surface in the app not made of the design's own
 * materials. It insets itself for the home indicator with `pb-safe`.
 */
import React from 'react';
import { View } from 'react-native';
import { Icon, type IconComponent } from '../interop';
import { Touchable } from '../Touchable';
import { Label } from './text';
import { cx } from './type';

export interface TabItem<T extends string = string> {
  key: T;
  label: string;
  icon: IconComponent;
  /** Greyed out rather than hidden — canvas S1: "lyzn greys out". */
  disabled?: boolean;
}

/** The three the canvas draws, in its order. */
export const TABS: TabItem[] = [
  { key: 'home', label: 'HOME', icon: Icon.House },
  { key: 'lyzn', label: 'LYZN', icon: Icon.MessageSquare },
  { key: 'pendant', label: 'PENDANT', icon: Icon.Bluetooth },
];

export function TabBar<T extends string>({
  items, value, onChange, className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <View className={cx('flex-row bg-tone-panel pb-safe', className)}>
      {items.map((item) => {
        const active = item.key === value;
        const tone = item.disabled ? 'faint' : active ? 'fg' : 'faint';
        return (
          <Touchable
            key={item.key}
            onPress={() => onChange(item.key)}
            disabled={item.disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!item.disabled }}
            accessibilityLabel={item.label.toLowerCase()}
            className="flex-1 items-center pt-[11px] pb-[13px]"
          >
            <item.icon
              className={cx('w-[22px] h-[22px] mb-[5px]', active ? 'text-tone-fg' : 'text-tone-faint')}
            />
            <Label variant="nav" tone={tone}>{item.label}</Label>
          </Touchable>
        );
      })}
    </View>
  );
}
