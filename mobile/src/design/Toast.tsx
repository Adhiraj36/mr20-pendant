/**
 * Transient confirmations — app spec §3.5.
 *
 * A long BLE operation needs to say it started, immediately — a spinner
 * alone leaves the user unsure whether the tap registered. Toasts are
 * queued so two rapid actions do not overwrite each other. Ink chrome on
 * every ground (spec §1.6): wrapped in `ToneProvider ground="ink"` rather
 * than relying on the tone context's ink default, so a toast reads right
 * even nested somewhere that default no longer holds.
 *
 * `Panel` radius 12, 1 px `line2`; no blur, no shadow (spec §4.5: blur
 * lives in only two places, and neither is here).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { space } from './tokens';
import { ToneProvider } from './tone';
import { useReducedMotionFlag } from './motion';

export type ToastTone = 'neutral' | 'success' | 'error' | 'busy';

interface Toast {
  id: number;
  message: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (message: string, options?: { detail?: string; tone?: ToastTone; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

/** The leading 6 pt square's colour (spec §3.5), as a class. */
const MARK_FILL: Record<ToastTone, string> = {
  success: 'bg-signal',
  error: 'bg-tone-danger',
  busy: 'bg-tone-faint',
  neutral: 'bg-tone-fg',
};

function ToastCard({ toast }: { toast: Toast }) {
  return (
    <View className="flex-row items-center gap-[12px] rounded-[12px] border-hairline border-tone-line2 bg-tone-panel py-[12px] px-[16px]">
      <View className={`w-[6px] h-[6px] ${MARK_FILL[toast.tone]}`} />
      <View className="flex-1 gap-[2px]">
        <Text className="font-sans-500 text-[14px] leading-[1.5] text-tone-fg" numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.detail ? (
          <Text className="font-sans-400 text-[14px] leading-[1.5] text-tone-muted" numberOfLines={2}>
            {toast.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const reduced = useReducedMotionFlag();

  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const id = ++nextId.current;
    const tone = options.tone ?? 'neutral';

    setToasts((current) => [...current.slice(-2), { id, message, detail: options.detail, tone }]);

    if (tone === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } else if (tone === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    }

    const timer = setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
      timers.current.delete(id);
    }, options.durationMs ?? (options.detail ? 4200 : 2800));
    timers.current.set(id, timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <View
        pointerEvents="none"
        className="absolute left-[16px] right-[16px] z-[1000]"
        style={{ top: insets.top + space.sm }}
      >
        {/* The stack's gap moved onto the provider: its View is where the
            tone's variables live, so it is a real box in the layout and the
            8pt between two toasts has to be set on it rather than on the
            host above it. */}
        <ToneProvider ground="ink" className="gap-[8px]">
          {toasts.map((toast) => (
            <Animated.View
              key={toast.id}
              // M15: y −8 → 0, opacity, 160 / out. Reduced motion: opacity
              // only — the same duration, no translate.
              entering={reduced ? FadeIn.duration(160) : FadeInUp.duration(160)}
              exiting={reduced ? FadeOut.duration(160) : FadeOutUp.duration(160)}
              layout={LinearTransition.duration(220)}
            >
              <ToastCard toast={toast} />
            </Animated.View>
          ))}
        </ToneProvider>
      </View>
    </ToastContext.Provider>
  );
}
