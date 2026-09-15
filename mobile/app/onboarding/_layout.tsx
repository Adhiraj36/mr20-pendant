/**
 * Setup is a sequence, so it slides forward.
 *
 * The stack's own background is the desk rather than ink: a screen paints
 * its own ground through `Screen`, but the navigator's canvas shows for a
 * frame during a push, and a dark flash between two light screens reads as
 * a glitch. It is a constant here because a navigator option cannot be a
 * Tailwind class.
 */
import { Stack } from 'expo-router';
import { useTheme } from '../../src/design/tone';
import { tones } from '../../src/design/tokens';

export default function OnboardingLayout() {
  const { ground } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: tones[ground].bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
