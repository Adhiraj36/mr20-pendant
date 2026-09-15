/**
 * Editing a task — canvas T3, "edits keep the original on record".
 *
 * The canvas edits a *draft message* before it is sent as you, with a
 * `SAVE & SEND` under it. On the Capture tier there is no draft and nothing
 * to send: what is editable is the sentence lyzn wrote down for the promise
 * it heard, so the editor holds the task's own text and the one button says
 * `SAVE`. The second button on the canvas — `SAVE WITHOUT SENDING` — only
 * means anything when there is a sending to decline, so it appears with
 * execution and not before (`[EXECUTION]`).
 *
 * The `ORIGINAL` card is the canvas' rule kept: what this said before you
 * changed it stays on screen while you change it. The backend keeps no
 * previous version, so the record is the value this screen opened with.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen, TopRow, TopAction, Txt, Label, Card, Button, Field, useToast,
} from '../../../src/design/kit';
import { TASKS_COPY } from '../../../src/design/copy';
import { useTasks } from '../../../src/state/tasks';

export default function TaskEdit() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const features = useTasks((s) => s.features);
  const tasks = useTasks((s) => s.tasks);
  const ensureTask = useTasks((s) => s.ensureTask);
  const editTask = useTasks((s) => s.editTask);

  const task = useMemo(() => tasks.find((t) => t.taskId === id), [tasks, id]);
  const [text, setText] = useState<string | undefined>(undefined);
  /** What it said when this screen opened — the record the canvas keeps. */
  const [original, setOriginal] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (id) ensureTask(id); }, [id, ensureTask]);

  useEffect(() => {
    if (!task || text !== undefined) return;
    setText(task.text);
    setOriginal(task.text);
  }, [task, text]);

  const value = text ?? '';
  const trimmed = value.trim();
  const changed = !!original && trimmed !== original.trim();
  const invalid = trimmed.length === 0;

  const save = useCallback(async () => {
    if (!task || invalid) return;
    if (!changed) { router.back(); return; }
    setBusy(true);
    try {
      await editTask(task.taskId, { text: trimmed });
      router.back();
    } catch {
      toast.show('That did not save', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [task, invalid, changed, editTask, trimmed, router, toast]);

  if (!task) {
    return (
      <Screen>
        <TopRow back="CANCEL" onBack={() => router.back()} />
        <View className="px-[20px] pt-[10px]">
          <Txt variant="statement">That task is not here any more.</Txt>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopRow
        back="CANCEL"
        onBack={() => router.back()}
        right={<TopAction label={TASKS_COPY.editing} tone="stamp" />}
      />

      <ScrollView contentContainerClassName="px-[20px] pb-[24px] gap-[11px]">
        <Field
          multiline
          autoFocus
          value={value}
          onChangeText={setText}
          maxLength={TASKS_COPY.textLimit}
          invalid={invalid}
          accessibilityLabel="what you promised"
          message={invalid
            ? 'A task needs words.'
            : `${value.length} / ${TASKS_COPY.textLimit}`}
        />

        {original ? (
          <Card pad="tight" className="gap-[6px]">
            <Label variant="eyebrow">{TASKS_COPY.original}</Label>
            <Txt variant="small" tone="muted">{original}</Txt>
          </Card>
        ) : null}

        {task.quote ? (
          <Card pad="tight" className="gap-[6px]">
            <Label variant="eyebrow">{TASKS_COPY.because}</Label>
            <Txt variant="quote" tone="muted">{`“${task.quote}”`}</Txt>
          </Card>
        ) : null}
      </ScrollView>

      <View className="gap-[9px] px-[20px] pt-[10px] pb-[16px]">
        <Button
          full
          title={features.execution ? TASKS_COPY.saveAndSend : TASKS_COPY.save}
          busy={busy}
          disabled={invalid}
          onPress={save}
        />
        {features.execution ? (
          <Button
            full
            variant="ghost"
            title={TASKS_COPY.saveWithoutSending}
            disabled={invalid}
            onPress={save}
          />
        ) : null}
      </View>
    </Screen>
  );
}
