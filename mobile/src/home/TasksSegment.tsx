/**
 * Home's TASKS segment — canvas T0 (Capture) and T1 (Execution).
 *
 * The gate. Everything the pendant heard you promise is here, and on the
 * Capture tier that is the whole product: lyzn lists what you said and the
 * doing is still yours, so the card says `YOU STILL HAVE TO DO THIS` out loud
 * instead of offering an APPROVE that would do nothing.
 *
 * A column of blocks, not a scroller: Home owns the scroll (T7), and a
 * `ScrollView` inside a `ScrollView` is a bug the first time someone flicks.
 *
 * The two ink strips — the selection bar and the upsell — are drawn as
 * `night`-toned subtrees rather than as hand-painted dark boxes. On the desk
 * that is the canvas' ink strip with its muted grey label and its paper
 * button; at night it is the same strip against the night's own ground. One
 * expression, both themes, and not a single colour named here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Txt, Label, Banner, Button, EmptyCard, Field, Sheet, TaskCard, Touchable,
  ToneProvider, useToast,
} from '../design/kit';
import { TASKS_COPY, approveLabel } from '../design/copy';
import { useApp } from '../state/store';
import { useTasks, useTaskGroups } from '../state/tasks';
import {
  clock, composeState, promiseEyebrow, receiptRef, selectionSummary,
  taskCardState, taskCardAction, taskEyebrowFor,
} from '../tasks/models';
import type { Task } from '../api/tasks';
import { UnlockSheet } from './UnlockSheet';

export interface SegmentProps {
  onOpenTask: (id: string) => void;
  /** `printed` is the difference between a receipt arriving and one being visited. */
  onOpenReceipt: (id: string, options?: { printed?: boolean }) => void;
}

export function TasksSegment({ onOpenTask, onOpenReceipt }: SegmentProps) {
  const toast = useToast();
  const plan = useApp((s) => s.plan);
  const features = useTasks((s) => s.features);
  const tasks = useTasks((s) => s.tasks);
  const loaded = useTasks((s) => s.tasksLoaded);
  const loading = useTasks((s) => s.tasksLoading);
  const error = useTasks((s) => s.tasksError);
  const cursor = useTasks((s) => s.tasksCursor);
  const selected = useTasks((s) => s.selected);
  const loadTasks = useTasks((s) => s.loadTasks);
  const loadMoreTasks = useTasks((s) => s.loadMoreTasks);
  const markDone = useTasks((s) => s.markDone);
  const toggleSelect = useTasks((s) => s.toggleSelect);
  const approve = useTasks((s) => s.approve);
  const sendToLaptop = useTasks((s) => s.sendToLaptop);
  const groups = useTaskGroups();
  const [unlock, setUnlock] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const eyebrow = useMemo(() => promiseEyebrow(tasks), [tasks]);
  const selectedTasks = useMemo(
    () => groups.open.filter((t) => selected.includes(t.taskId)),
    [groups.open, selected],
  );

  /**
   * Marking done is the one place a receipt is born, so the screen goes
   * straight to it and lets it print — `printed=1` is what R1 reads to know
   * this is an arrival rather than a visit (ruling R14).
   */
  const onMarkDone = useCallback(async (task: Task) => {
    setBusy(task.taskId);
    try {
      const receipt = await markDone(task.taskId);
      // `printed` is what makes the slip play M2 once. Without it the receipt
      // that this tap just created renders finished and still, as though it
      // had always been there (ruling R14).
      if (receipt) onOpenReceipt(receipt.receiptId, { printed: true });
    } catch (err) {
      toast.show(TASKS_COPY.doneFailed, { detail: reason(err), tone: 'error' });
    } finally {
      setBusy(undefined);
    }
  }, [markDone, onOpenReceipt, toast]);

  const onApprove = useCallback(async () => {
    const outcome = await approve(selected);
    // A 402 is the price, not a failure: the answer to it is the chooser.
    if (outcome.paymentRequired) setUnlock(true);
  }, [approve, selected]);

  // Approving one task straight from its card. The card's APPROVE button used
  // to only select the task, so a tap did nothing visible; this sends it.
  const onApproveOne = useCallback(async (taskId: string) => {
    setBusy(taskId);
    try {
      const outcome = await approve([taskId]);
      if (outcome.paymentRequired) setUnlock(true);
      else if (outcome.approved === 0) toast.show(TASKS_COPY.approveFailed, { tone: 'error' });
    } finally {
      setBusy(undefined);
    }
  }, [approve, toast]);

  /**
   * A task nobody said out loud, handed straight to the laptop.
   *
   * Nothing here says whether a machine is awake to take it. An approved task
   * with nothing paired is exactly what Home's `daemonNone` banner exists to
   * say, and it says it the moment this returns.
   */
  const onSend = useCallback(async () => {
    if (sending || draft.trim().length === 0) return;
    setSending(true);
    const outcome = await sendToLaptop(draft);
    setSending(false);
    if (outcome.paymentRequired) {
      setCompose(false);
      setUnlock(true);
      return;
    }
    if (!outcome.ok) {
      toast.show(TASKS_COPY.composeFailed, { tone: 'error' });
      return;
    }
    setCompose(false);
    setDraft('');
    toast.show(TASKS_COPY.composeSent);
  }, [draft, sending, sendToLaptop, toast]);

  const offer = composeState(features, plan);

  /**
   * Drawn in both branches below, which is the point: somebody with no tasks
   * at all is exactly the person who wants to write one, and the empty state
   * is where they are standing.
   */
  const writeOne = offer === 'hidden' ? null : (
    <Button
      full
      variant="secondary"
      title={TASKS_COPY.writeOne}
      onPress={() => (offer === 'send' ? setCompose(true) : setUnlock(true))}
    />
  );

  const composeSheet = (
    <Sheet
      visible={compose}
      onClose={() => setCompose(false)}
      title={TASKS_COPY.composeTitle}
    >
      <Field
        value={draft}
        onChangeText={setDraft}
        placeholder={TASKS_COPY.composePlaceholder}
        multiline
        autoFocus
        accessibilityLabel="what the laptop should do"
      />
      <Button
        full
        title={TASKS_COPY.composeSend}
        busy={sending}
        busyLabel={TASKS_COPY.composeSending}
        disabled={draft.trim().length === 0}
        onPress={onSend}
        className="mt-[12px]"
      />
    </Sheet>
  );

  /**
   * The failure, drawn over whatever is already here.
   *
   * A list that could not be read is not an empty list. The banner is above
   * both branches below so it is drawn either way, and it carries the one
   * action that could change the answer.
   */
  const banner = error ? (
    <Banner
      variant="void"
      label={[TASKS_COPY.couldNotLoad, error]}
      action={TASKS_COPY.retry}
      onAction={() => loadTasks({ reset: true })}
      className="-mx-[18px] mb-[9px]"
    />
  ) : null;

  // Nothing at all, and nothing pending: canvas S3, in the segment's own
  // words rather than a spinner or a shrug. A list that has never loaded and
  // is still loading gets neither — it gets the line that says so.
  if (loaded && tasks.length === 0) {
    return (
      <View className="gap-[9px]">
        {banner}
        <EmptyCard
          eyebrow={TASKS_COPY.segmentEmptyEyebrow}
          statement={TASKS_COPY.segmentEmptyStatement}
          line={TASKS_COPY.segmentEmptyLine(features.execution)}
        />
        {writeOne}
        {composeSheet}
        <UnlockSheet visible={unlock} onClose={() => setUnlock(false)} />
      </View>
    );
  }
  if (!loaded && tasks.length === 0) {
    return (
      <View className="gap-[9px]">
        {banner}
        {loading ? <Label variant="eyebrow">{TASKS_COPY.loading}</Label> : null}
      </View>
    );
  }

  const upsell = features.execution && !plan?.automation;

  return (
    <View className="gap-[9px]">
      {banner}
      {eyebrow ? (
        <Label variant="ghost" tone="danger" numberOfLines={2} className="mb-[2px]">
          {eyebrow}
        </Label>
      ) : null}

      {groups.failed.map((task) => (
        <TaskCard
          key={task.taskId}
          state="failed"
          eyebrow={taskEyebrowFor(task, features)}
          title={task.text}
          meta={task.updatedAt ? `TRIED ${clock(task.updatedAt)} · STOPPED` : undefined}
          reason={TASKS_COPY.failedFallback}
          onPress={() => onOpenTask(task.taskId)}
          primaryAction={features.execution ? { label: TASKS_COPY.tryAgain } : undefined}
          secondaryAction={{
            label: TASKS_COPY.whatHappened,
            onPress: () => onOpenTask(task.taskId),
          }}
        />
      ))}

      {groups.open.map((task) => {
        const state = taskCardState(task, features);
        const action = taskCardAction(state);
        const isSelected = selected.includes(task.taskId);
        return (
          <TaskCard
            key={task.taskId}
            state={state}
            eyebrow={taskEyebrowFor(task, features)}
            title={task.text}
            quote={task.quote}
            onPress={() => onOpenTask(task.taskId)}
            selected={isSelected}
            onToggleSelect={
              features.execution ? () => toggleSelect(task.taskId) : undefined
            }
            primaryAction={
              action === 'markDone'
                ? {
                  label: busy === task.taskId ? '…' : TASKS_COPY.markDone,
                  onPress: () => onMarkDone(task),
                }
                : action === 'approve'
                  ? {
                    label: busy === task.taskId ? '…' : TASKS_COPY.approve,
                    onPress: () => onApproveOne(task.taskId),
                  }
                  : action === 'answer'
                    ? { label: TASKS_COPY.answer, onPress: () => onOpenTask(task.taskId) }
                    : undefined
            }
            // Only the `waiting` card draws a second action — the kit's
            // `capture` card is one line and one button by design (canvas T0),
            // and a `secondaryAction` handed to it renders nothing at all.
            // Dropping a promise lives on the detail, where it has room to say
            // what it means.
            secondaryAction={
              state === 'waiting'
                ? { label: TASKS_COPY.edit, onPress: () => onOpenTask(task.taskId) }
                : undefined
            }
          />
        );
      })}

      {groups.settled.length > 0 ? (
        <Label variant="eyebrow" className="mt-[9px]">{TASKS_COPY.settled}</Label>
      ) : null}

      {groups.settled.map((task) => (
        <TaskCard
          key={task.taskId}
          state="done"
          title={task.text}
          meta={task.doneAt ? `DONE ${clock(task.doneAt)}` : undefined}
          receiptRef={task.receiptId ? `RECEIPT ${receiptRef(task.receiptId)}` : undefined}
          onOpenReceipt={task.receiptId ? () => onOpenReceipt(task.receiptId!) : undefined}
          onPress={() => onOpenTask(task.taskId)}
        />
      ))}

      {groups.dropped.length > 0 ? (
        <Label variant="eyebrow" className="mt-[6px]">
          {`${groups.dropped.length} DROPPED`}
        </Label>
      ) : null}

      {/* Canvas T1's bar. It sits at the end of the column rather than
          pinned to the bottom of the window: the segment is a block inside
          Home's scroller and cannot position itself against the screen.
          Only ever reachable under `features.execution`. */}
      {features.execution && selectedTasks.length > 0 ? (
        <ToneProvider ground="night" className="mt-[6px]">
          <View className="flex-row items-center gap-[11px] bg-tone-bg py-[14px] px-[18px]">
            <Label variant="action" tone="muted" numberOfLines={2} className="flex-1">
              {selectionSummary(selectedTasks)}
            </Label>
            <Button
              title={approveLabel(selectedTasks.length)}
              onPress={onApprove}
            />
          </View>
        </ToneProvider>
      ) : null}

      {/* Canvas T0's strip: shown only when execution is something this app
          can actually sell — the flag is on and this plan does not have it.
          With the flag off there is nothing to offer, so there is no strip. */}
      {upsell ? (
        <ToneProvider ground="night" className="mt-[6px]">
          <Touchable
            onPress={() => setUnlock(true)}
            accessibilityRole="button"
            accessibilityLabel="add execution"
            className="flex-row items-center gap-[12px] bg-tone-bg py-[15px] px-[18px]"
          >
            <View className="flex-1 gap-[3px]">
              <Label variant="tag" tone="muted">{TASKS_COPY.upsellEyebrow}</Label>
              <Txt variant="strong" tone="fg">{TASKS_COPY.upsellLine}</Txt>
            </View>
            <Label variant="action" tone="fg">→</Label>
          </Touchable>
        </ToneProvider>
      ) : null}

      {/* The cursor, made visible. Home asks for the next page when the
          scroller reaches the bottom; this is the same request with a name
          on it, for a list that ends above the fold. */}
      {cursor ? (
        <Touchable
          onPress={() => void loadMoreTasks()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="load more tasks"
          className="py-[16px] items-center"
        >
          <Label variant="eyebrow">{loading ? TASKS_COPY.loading : TASKS_COPY.loadMore}</Label>
        </Touchable>
      ) : null}

      {/* Under the list rather than over it: the promises somebody already
          made are the segment's subject, and writing a new one is the thing
          you do after reading them. */}
      {writeOne}

      {composeSheet}
      <UnlockSheet visible={unlock} onClose={() => setUnlock(false)} />
    </View>
  );
}

/** A failure, in the words the server used. Never "something went wrong". */
function reason(err: unknown): string | undefined {
  return err instanceof Error && err.message ? err.message : undefined;
}
