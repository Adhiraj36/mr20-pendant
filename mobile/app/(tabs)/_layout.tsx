/**
 * The tab bar — canvas H1: `HOME · LYZN · PENDANT` on a paper strip.
 *
 * Drawn, not native. The canvas' bar is a sheet of paper lying on the desk
 * with mono labels and a hairline above it; UITabBar is blurred system
 * chrome and would be the one surface in the app not made of the design's
 * own materials. `Tabs` still owns the navigation state — this replaces the
 * bar it renders, nothing else — so deep links, `router.push` and the back
 * stack behave exactly as they did.
 *
 * The greyed tab is canvas S1: when the daemon is asleep, LYZN cannot answer
 * and says so by receding rather than by disappearing. The daemon does not
 * exist yet (`features.daemon` is off), so nothing is disabled today; the
 * shape is here so that turning the flag on is a one-line change.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { TabBar, TABS, ToneProvider } from '@/design/kit';
import { useTheme } from '@/design/tone';

/** The route name each tab points at, in the canvas' order. */
const ROUTES = ['index', 'lyzn', 'pendant'] as const;

/**
 * What React Navigation hands a custom `tabBar`. Declared here rather than
 * imported: `@react-navigation/bottom-tabs` is expo-router's own transitive
 * dependency, and naming it as ours would pin a version we do not manage.
 */
interface TabBarProps {
  state: { index: number; routes: { name: string }[] };
  navigation: { navigate: (route: string) => void };
}

function Bar({ state, navigation }: TabBarProps) {
  const current = state.routes[state.index]?.name ?? 'index';
  const value = TABS[Math.max(0, ROUTES.indexOf(current as (typeof ROUTES)[number]))]!.key;
  // The bar is drawn by the navigator, outside every `Screen`, so it is
  // outside the variables a screen's ground writes. It carries its own —
  // the theme's, which is the ground the screen above it is standing on.
  const { ground } = useTheme();

  return (
    <ToneProvider ground={ground} style={{ borderTopWidth: StyleSheet.hairlineWidth }} className="border-tone-line">
      <TabBar
        items={TABS}
        value={value}
        onChange={(next) => {
          const route = ROUTES[TABS.findIndex((t) => t.key === next)] ?? 'index';
          // `navigate` rather than `push`: a tab press returns to a tab, it
          // does not stack a second copy of it.
          navigation.navigate(route);
        }}
      />
    </ToneProvider>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <Bar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="lyzn" />
      <Tabs.Screen name="pendant" />
    </Tabs>
  );
}
