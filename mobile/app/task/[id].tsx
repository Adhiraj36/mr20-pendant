/**
 * One task — canvas T2 (waiting), and T5 when it went wrong.
 *
 * The screen answers four questions in the order a person asks them: what is
 * this, why does lyzn think I said it, what happens next, and what happens if
 * I ignore it. On the Capture tier the third question has an honest answer of
 * "nothing, until you do it", so the two cards that describe acting — `WHAT
 * WILL HAPPEN` and `THE EXACT MESSAGE` — are not drawn at all rather than
 * drawn empty (`[EXECUTION]`).
 *
 * `BECAUSE YOU SAID` is the one card that is never conditional. It is the
 * whole claim the product makes: this is not a to-do somebody typed, it is
 * something the pendant heard, and here is the sentence and the minute.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen, TopRow, TopAction, Txt, Label, Card, Button, Field, KeyValues, Touchable,
  useToast,
} from '../../src/design/kit';
import { TASKS_COPY } from '../../src/design/copy';
import { api, type Recording, type Transcript } from '../../src/api/client';
import { useTasks } from '../../src/state/tasks';
import {
  clock, receiptRef, sourceLine, taskDetailEyebrow, taskEyebrowFor,
  utteranceAt,
} from '../../src/tasks/models';

export default function TaskDetail() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const features = useTasks((s) => s.features);
  const tasks = useTasks((s) => s.tasks);
  const error = useTasks((s) => s.tasksError);
  const ensureTask = useTasks((s) => s.ensureTask);
  const markDone = useTasks((s) => s.markDone);
  const dismiss = useTasks((s) => s.dismiss);
  const answerQuestion = useTasks((s) => s.answerQuestion);

  const task = useMemo(() => tasks.find((t) => t.taskId === id), [tasks, id]);
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
  const [source, setSource] = useState<{
    recording: Recording; transcript: Transcript | null;
  } | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    ensureTask(id).finally(() => setLooked(true));
  }, [id, ensureTask]);

  // The conversation behind the quote. One request, on a screen that already
  // costs a navigation — and the only way to know both what the conversation
  // was called and when inside it this was said.
  useEffect(() => {
    let live = true;
    if (!task?.recordingId) return;
    api.getRecording(task.recordingId)
      .then((result) => { if (live) setSource(result); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [task?.recordingId]);

  const saidAt = useMemo(() => {
    if (!source) return undefined;
    const line = task?.utteranceIndex !== undefined
      ? source.transcript?.utterances?.[task.utteranceIndex]
      : undefined;
    return utteranceAt(source.recording.startedAt, line?.start);
  }, [source, task?.utteranceIndex]);

  const onMarkDone = useCallback(async () => {
    if (!task) return;
    setBusy(true);
    try {
      const receipt = await markDone(task.taskId);
      if (receipt) router.replace(`/receipt/${receipt.receiptId}?printed=1`);
      else router.back();
    } catch (err) {
      toast.show(TASKS_COPY.doneFailed, {
        detail: (err as Error).message, tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [task, markDone, router, toast]);

  const onDismiss = useCallback(async () => {
    if (!task) return;
    try {
      await dismiss(task.taskId);
      router.back();
    } catch (err) {
      toast.show(TASKS_COPY.dismissFailed, {
        detail: (err as Error).message, tone: 'error',
      });
    }
  }, [task, dismiss, router, toast]);

  const onAnswer = useCallback(async (text: string) => {
    if (!task || !text.trim() || answering) return;
    setAnswering(true);
    const outcome = await answerQuestion(task.taskId, text.trim());
    setAnswering(false);
    if (outcome.ok) {
      setAnswer('');
      toast.show(TASKS_COPY.answerSent);
    } else {
      toast.show(TASKS_COPY.answerFailed, { tone: 'error' });
    }
  }, [task, answering, answerQuestion, toast]);

  if (!task) {
    // Three different things, and they do not get the same screen: still
    // looking, looked and it is gone, and could not look at all — only the
    // last of those has a retry, and only the middle one is a fact.
    return (
      <Screen>
        <TopRow back="TASKS" onBack={() => router.back()} />
        <View className="px-[20px] pt-[10px] gap-[11px]">
          <Txt variant="statement">
            {!looked
              ? 'Finding it…'
              : error
                ? 'That task could not be loaded.'
                : 'That task is not here any more.'}
          </Txt>
          {looked && error ? (
            <>
              <Txt variant="bodyL" tone="muted">{error}</Txt>
              <Button
                title={TASKS_COPY.retry}
                onPress={() => { setLooked(false); ensureTask(id).finally(() => setLooked(true)); }}
              />
            </>
          ) : null}
        </View>
      </Screen>
    );
  }

  const blocked = task.status === 'blocked';
  const failed = task.status === 'failed';
  const settled = task.status === 'done' || task.status === 'dismissed';

  return (
    <Screen>
      <TopRow
        back="TASKS"
        onBack={() => router.back()}
        right={settled || blocked ? undefined : (
          <TopAction label={TASKS_COPY.dismiss} tone="danger" onPress={onDismiss} />
        )}
      />

      <ScrollView contentContainerClassName="px-[20px] pb-[28px] gap-[11px]">
        <Label
          variant="back"
          tone={failed ? 'danger' : 'stamp'}
          numberOfLines={2}
          className="mb-[2px]"
        >
          {taskDetailEyebrow(task, features)}
        </Label>
        <Txt variant="title" className="mb-[4px]">{task.text}</Txt>

        {/* The claim. Never conditional, never abbreviated. */}
        <Card pad="tight" className="gap-[8px]">
          <Label variant="eyebrow">{TASKS_COPY.because}</Label>
          <Txt variant="body">{task.quote ? `“${task.quote}”` : '—'}</Txt>
          {task.recordingId ? (
            <Touchable
              onPress={() => router.push(
                `/recording/${task.recordingId}${
                  task.utteranceIndex !== undefined ? `?utterance=${task.utteranceIndex}` : ''
                }`,
              )}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel="open the conversation"
            >
              <Label variant="tag" tone="stamp">
                {`${sourceLine(source?.recording.title ?? 'THE CONVERSATION', saidAt)} →`}
              </Label>
            </Touchable>
          ) : null}
        </Card>

        {blocked && task.question ? (
          <Card variant="carbon" className="gap-[8px]">
            <Label variant="eyebrow">{TASKS_COPY.question}</Label>
            <Txt variant="strong">{task.question.text}</Txt>
            {task.question.answer ? (
              <Label variant="tag" tone="stamp">{TASKS_COPY.answerWaiting}</Label>
            ) : null}
          </Card>
        ) : null}

        {/* Canvas T5. Nothing writes `failed` today, so this is only ever
            reached by a backend that has started to (`[EXECUTION]`). */}
        {failed ? (
          <Card variant="void" className="gap-[8px]">
            <Label variant="eyebrow">{TASKS_COPY.whatHappened}</Label>
            <Txt variant="strong">{TASKS_COPY.failedFallback}</Txt>
            <Label variant="tag">{[`TRIED ${clock(task.updatedAt)}`, 'STOPPED']}</Label>
          </Card>
        ) : null}

        {/* What acting on this would do. There is no honest version of these
            two cards on the Capture tier, so there is no version of them. */}
        {features.execution && !settled ? (
          <Card variant="carbon" className="gap-[6px]">
            <Label variant="eyebrow">{TASKS_COPY.whatWillHappen}</Label>
            <KeyValues
              rows={[
                { k: 'DOES', v: taskEyebrowFor(task, features) },
                ...(task.dueAt ? [{ k: 'DUE', v: clock(task.dueAt) }] : []),
                { k: 'GATED BECAUSE', v: 'IT ACTS AS YOU' },
              ]}
            />
          </Card>
        ) : null}

        {features.execution && !settled ? (
          <Card className="gap-[8px]">
            <View className="flex-row justify-between items-baseline">
              <Label variant="eyebrow">{TASKS_COPY.exactMessage}</Label>
              <Touchable
                onPress={() => router.push(`/task/${task.taskId}/edit`)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="edit"
              >
                <Label variant="tag" tone="stamp">{TASKS_COPY.edit}</Label>
              </Touchable>
            </View>
            <Txt variant="bodyL">{task.text}</Txt>
          </Card>
        ) : null}

        {settled ? (
          <Card className="gap-[7px]">
            <Label variant="eyebrow">
              {task.status === 'done' ? 'KEPT' : 'DROPPED'}
            </Label>
            <Txt variant="strong">
              {task.status === 'done'
                ? 'You marked this done. The receipt is the record.'
                : 'You dropped this. It stays here, and nothing happened.'}
            </Txt>
            {task.receiptId ? (
              <Touchable
                onPress={() => router.push(`/receipt/${task.receiptId}`)}
                hitSlop={8}
                accessibilityRole="link"
                accessibilityLabel="open the receipt"
              >
                <Label variant="tag" tone="stamp">
                  {`RECEIPT ${receiptRef(task.receiptId)} →`}
                </Label>
              </Touchable>
            ) : null}
          </Card>
        ) : (
          <Card pad="tight" className="gap-[7px]">
            <Label variant="eyebrow">{TASKS_COPY.ifYouDoNothing}</Label>
            <Txt variant="bodyL" tone="muted">
              {TASKS_COPY.ifYouDoNothingBody(features.execution)}
            </Txt>
          </Card>
        )}
      </ScrollView>

      {settled ? null : blocked && task.question && !task.question.answer ? (
        <View className="px-[20px] pt-[10px] pb-[16px] gap-[9px]">
          {task.question.options?.length ? (
            <View className="gap-[7px]">
              {task.question.options.map((option) => (
                <Button
                  key={option}
                  full
                  variant="secondary"
                  title={option}
                  busy={answering}
                  onPress={() => onAnswer(option)}
                />
              ))}
            </View>
          ) : (
            <>
              <Field
                value={answer}
                onChangeText={setAnswer}
                placeholder={TASKS_COPY.answerPlaceholder}
                multiline
                accessibilityLabel="your answer"
              />
              <Button
                full
                title={TASKS_COPY.sendAnswer}
                busy={answering}
                busyLabel={TASKS_COPY.answerSending}
                disabled={answer.trim().length === 0}
                onPress={() => onAnswer(answer)}
              />
            </>
          )}
        </View>
      ) : blocked ? null : (
        <View className="flex-row gap-[9px] px-[20px] pt-[10px] pb-[16px]">
          <Button
            className="flex-1"
            title={TASKS_COPY.markDone}
            busy={busy}
            onPress={onMarkDone}
          />
          <Button
            className="flex-1"
            variant="secondary"
            title={TASKS_COPY.edit}
            onPress={() => router.push(`/task/${task.taskId}/edit`)}
          />
        </View>
      )}
    </Screen>
  );
}
