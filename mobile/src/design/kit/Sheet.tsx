/**
 * The bottom sheet — canvas C4: a handle, a header row, a carbon context
 * strip that says what the sheet is scoped to, and the body.
 *
 * It rises over the screen it belongs to rather than replacing it, and the
 * screen stays visible and dimmed above it, because the sheet is a question
 * *about* what is behind it. Keyboard-avoiding, since every sheet on the
 * canvas ends in a field.
 */
import React from 'react';
import { Modal, View, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { Icon, type IconComponent } from '../interop';
import { Touchable } from '../Touchable';
import { Label, Txt } from './text';
import { metaLine } from './models';
import { cx } from './type';

export function Sheet({
  visible, onClose, title, icon, context, closeLabel = 'CLOSE ✕', children, className,
}: {
  visible: boolean;
  onClose: () => void;
  /** `ASK LYZN` — mono, uppercase, beside its icon. */
  title: string;
  icon?: IconComponent;
  /** The carbon strip: what this sheet can see. */
  context?: string | (string | number | undefined | false | null)[];
  closeLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const Glyph = icon ?? Icon.MessageSquare;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 justify-end">
        {/* The screen behind, dimmed. Tapping it is the second way out; the
            first is the close word, which is the one a screen reader finds. */}
        <Pressable
          className="absolute inset-0 bg-night/[0.34]"
          onPress={onClose}
          accessibilityLabel="close"
          accessibilityRole="button"
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className={cx('bg-tone-panel pb-safe', className)}>
            {/* 44 × 3 — the canvas' handle, and the only rounded thing on the
                sheet besides the toggle that might sit inside it. */}
            <View className="items-center pt-[10px]">
              <View className="w-[44px] h-[3px] bg-tone-line rounded-full" />
            </View>

            <View className="flex-row justify-between items-center py-[12px] px-[20px]">
              <View className="flex-row items-center gap-[8px]">
                <Glyph className="w-[14px] h-[14px] text-tone-fg" />
                <Label variant="back" tone="fg">{title}</Label>
              </View>
              <Touchable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="close"
              >
                <Label variant="back">{closeLabel}</Label>
              </Touchable>
            </View>

            {context ? (
              <View className="flex-row items-center gap-[9px] py-[11px] px-[20px] bg-tone-carbon">
                <Label variant="chip">CONTEXT</Label>
                {/* Sentence case and sans, as the canvas sets it (C4): the
                    strip says what the sheet can see, and that is a sentence
                    rather than a label. */}
                <Txt variant="quote" className="flex-1" numberOfLines={2}>
                  {Array.isArray(context) ? metaLine(context) : context}
                </Txt>
              </View>
            ) : null}

            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
