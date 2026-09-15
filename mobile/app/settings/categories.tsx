/**
 * Categories — how you file conversations. Reached from Settings.
 *
 * Edits are staged locally and saved in one PUT: the server keeps the id of
 * every entry that still carries one, so a rename never orphans the
 * recordings filed under it. Deleting one leaves its conversations
 * uncategorised, and the confirmation says so rather than implying they go
 * with it.
 *
 * The save sits in a solid bar at the bottom rather than at the end of the
 * scroll, because it is the one control on the screen that has to be
 * reachable with a thumb whatever the list has grown to.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button, Card, Field, Icon, Label, Screen, TopRow, Touchable, Txt, useToast,
} from '@/design/kit';
import { CATEGORIES } from '@/design/copy';
import { useReducedMotionFlag } from '@/design/motion';
import { useApp } from '@/state/store';
import type { Category } from '@/api/client';

export default function CategoriesScreen() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotionFlag();

  const categories = useApp((s) => s.categories);
  const loadCategories = useApp((s) => s.loadCategories);
  const saveCategories = useApp((s) => s.saveCategories);

  const [draft, setDraft] = useState<Category[]>(categories);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { void loadCategories(); }, [loadCategories]);
  // Adopt what the server says until the person starts editing; after that
  // their draft wins over any refresh that lands behind them.
  useEffect(() => { if (!dirty) setDraft(categories); }, [categories, dirty]);

  const rename = useCallback((index: number, name: string) => {
    setDirty(true);
    setDraft((was) => was.map((category, i) => (i === index ? { ...category, name } : category)));
  }, []);

  const remove = useCallback((category: Category, index: number) => {
    Alert.alert(CATEGORIES.deleteTitle(category.name), CATEGORIES.deleteLine, [
      { text: CATEGORIES.cancel, style: 'cancel' },
      {
        text: CATEGORIES.delete,
        style: 'destructive',
        onPress: () => {
          setDirty(true);
          setDraft((was) => was.filter((_, i) => i !== index));
        },
      },
    ]);
  }, []);

  const add = useCallback(() => {
    const name = adding.trim();
    if (!name) return;
    setDirty(true);
    // A new entry carries no id; the server mints one when it is saved.
    setDraft((was) => [...was, { id: '', name }]);
    setAdding('');
  }, [adding]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await saveCategories(draft.filter((category) => category.name.trim().length > 0));
      setDirty(false);
      toast.show(CATEGORIES.saved, { tone: 'success' });
      router.back();
    } catch {
      toast.show(CATEGORIES.saveFailed, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }, [draft, saveCategories, toast, router]);

  return (
    <Screen edges={['top']}>
      <TopRow back={CATEGORIES.back} onBack={() => router.back()} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View className="px-[18px] pb-[14px]">
            <Txt variant="screen">{CATEGORIES.title}</Txt>
            <Txt variant="bodyL" tone="muted" className="mt-[8px]">{CATEGORIES.line}</Txt>
          </View>

          <View className="px-[18px] gap-[8px]">
            {draft.map((category, index) => (
              <Animated.View
                key={`${category.id || 'new'}-${index}`}
                layout={reduced ? undefined : LinearTransition.duration(220)}
              >
                <Card pad="none">
                  <View className="flex-row items-center gap-[10px] px-[15px] py-[10px]">
                    <Field
                      value={category.name}
                      onChangeText={(next) => rename(index, next)}
                      placeholder={CATEGORIES.namePlaceholder}
                      className="flex-1"
                    />
                    <Touchable
                      onPress={() => remove(category, index)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={CATEGORIES.removeLabel(category.name)}
                    >
                      <Icon.X className="w-[18px] h-[18px] text-tone-faint" />
                    </Touchable>
                  </View>
                </Card>
              </Animated.View>
            ))}

            {draft.length === 0 ? (
              <Label variant="value" tone="faint">{CATEGORIES.none}</Label>
            ) : null}

            <View className="mt-[12px] gap-[8px]">
              <Label variant="eyebrow">{CATEGORIES.addEyebrow}</Label>
              <View className="flex-row items-center gap-[8px]">
                <Field
                  value={adding}
                  onChangeText={setAdding}
                  onSubmitEditing={add}
                  placeholder={CATEGORIES.addPlaceholder}
                  returnKeyType="done"
                  className="flex-1"
                />
                <Button title={CATEGORIES.add} variant="secondary" size="compact" onPress={add} />
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          className="border-t border-tone-line bg-tone-panel px-[18px] pt-[12px]"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <Button
            title={CATEGORIES.save}
            onPress={save}
            busy={saving}
            disabled={!dirty}
            full
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
