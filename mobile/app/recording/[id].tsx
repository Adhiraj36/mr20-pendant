/**
 * One conversation — canvas C2, with C1's header while it is still being
 * made.
 *
 * Top to bottom: what it was, the player, what you promised, what it meant,
 * **what it taught the memory**, and then every word of it. The order is the
 * canvas' and it is an argument — the summary is why you opened this, the
 * transcript is the evidence, and the facts card is the only place in the
 * app that says out loud what lyzn now knows.
 *
 * Nothing the old detail screen did was dropped (research §2): the same
 * audio source priority, the same follow-along and sweep, the same
 * `matchActionSource` reveal, the same enhanced/original toggle, retry,
 * pipeline block and delete-with-confirm. Two things are new — the facts
 * card, and a speaker rename that says what it costs: the conversation is
 * re-filed to memory with the names, and the card's version says so.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  View, ScrollView, Text, Alert, Share, type LayoutChangeEvent,
  type GestureResponderEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Screen, TopRow, TopAction, Txt, Label, Card, Banner, Button, Chip, Progress,
  Field, Sheet, Touchable, Icon, MarkPulse, useToast, cx,
} from '../../src/design/kit';
import { api, type Recording, type Transcript } from '../../src/api/client';
import * as library from '../../src/sync/library';
import { useApp } from '../../src/state/store';
import { useTasks } from '../../src/state/tasks';
import { isOpen } from '../../src/tasks/models';
import type { Task } from '../../src/api/tasks';
import { formatClock } from '../../src/design/tokens';
import { formatDayStamp, formatSpan } from '../../src/recordings/grouping';
import {
  clockSpan, commitmentsHeading, factKind, factsHeading, languageChip,
  summaryHeading, summaryPoints, wallClock,
} from '../../src/recordings/conversation';
import { loadActionDone, saveActionDone } from '../../src/recordings/actionDone';
import { matchActionSource, type ActionMatch } from '../../src/recordings/actionSource';
import { seekSnapshot, subscribeSeek, takeSeek } from '../../src/recordings/seek';
import { CONVERSATION } from '../../src/design/copy';

/** The pipeline block's copy, one banner per state (canvas C1's own words). */
const PIPELINE: Partial<Record<Recording['status'], { label: string; line: string }>> = {
  pending: { label: CONVERSATION.onPhone, line: CONVERSATION.onPhoneLine },
  uploaded: { label: CONVERSATION.queued, line: CONVERSATION.queuedLine },
  processing: { label: CONVERSATION.transcribing, line: CONVERSATION.transcribingLine },
  archived: { label: CONVERSATION.noSpeech, line: CONVERSATION.noSpeechLine },
};

/** The speeds the player cycles through, in the order the tap walks them. */
const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** The jump either side of the playhead. Fifteen seconds is the podcast rule. */
const JUMP_SECONDS = 15;

export default function RecordingDetail() {
  return (
    <Screen>
      <DetailPage />
    </Screen>
  );
}

function DetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const loadRecordings = useApp((s) => s.loadRecordings);
  const info = useApp((s) => s.info);
  const link = useApp((s) => s.link);

  /**
   * The commitments this conversation left behind, as the account holds
   * them.
   *
   * They used to be `recording.actionItems` with a tick per item saved on
   * this handset — which meant the card and the TASKS segment could disagree
   * about the same promise, and marking one done here left the task on the
   * segment untouched. Both read `GET /tasks` now; the tick is the task's
   * own status, and a row opens the task.
   */
  const allTasks = useTasks((s) => s.tasks);
  const loadTasks = useTasks((s) => s.loadTasks);
  const markTaskDone = useTasks((s) => s.markDone);
  useEffect(() => { loadTasks(); }, [loadTasks]);

  const [recording, setRecording] = useState<Recording>();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>();
  /** Enhanced (denoised, silence-cut) playback URL, when the pipeline made one. */
  const [enhancedUrl, setEnhancedUrl] = useState<string>();
  /** The untouched original: the phone's own copy, or a presigned raw URL. */
  const [originalUrl, setOriginalUrl] = useState<string>();
  const [variant, setVariant] = useState<'enhanced' | 'original'>('enhanced');
  const [speed, setSpeed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [renaming, setRenaming] = useState<number>();
  const [retrying, setRetrying] = useState(false);
  const [done, setDone] = useState<boolean[]>([]);

  const player = useAudioPlayer(audioUrl ? { uri: audioUrl } : null);
  const status = useAudioPlayerStatus(player);

  /**
   * Let the sound out.
   *
   * The default session plays nothing while an iPhone's ringer switch is on
   * silent, which from this screen is indistinguishable from a player that is
   * broken: the button toggles, the sweep moves, and no one hears anything.
   * A phone capture leaves the session in the recorder's own mode too, so
   * this screen states what it needs rather than inheriting whatever the last
   * feature left behind. Never fatal — a session that refuses to change still
   * plays for everyone whose ringer is on.
   */
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false })
      .catch(() => undefined);
  }, []);

  /**
   * Bumped by the failure state's `TRY AGAIN`.
   *
   * The load below is an effect over `id`, and a screen that failed has the
   * same `id` it always had — so retrying needs a second dependency that the
   * button can move. Cheaper than lifting the whole body into a callback the
   * effect would then have to depend on.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(undefined);
      try {
        const detail = await api.getRecording(id);
        if (cancelled) return;
        setRecording(detail.recording);
        setTranscript(detail.transcript);

        // Listening must not wait for the transcript: while a recording is
        // queued or transcribing the audio is already here (the phone's own
        // copy, free and instant) or in S3. Only 'pending' has no object yet.
        //
        // Once the pipeline has produced an enhanced version (denoised,
        // silence cut) that is what plays — it is also what the transcript
        // timestamps line up with. The raw audio stays one small tap away.
        const local = await library.localUri(detail.recording.deviceFolder, detail.recording.deviceFile);
        if (cancelled) return;
        if (local) setOriginalUrl(local);
        if (detail.recording.cleanKey) {
          const { url } = await api.getAudioUrl(id);
          if (!cancelled) { setEnhancedUrl(url); setAudioUrl(url); }
        } else if (local) {
          setAudioUrl(local);
          setVariant('original');
        } else if (detail.recording.status !== 'pending') {
          const { url } = await api.getAudioUrl(id, { raw: true });
          if (!cancelled) {
            setOriginalUrl(url);
            setAudioUrl(url);
            setVariant('original');
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, attempt]);

  // `[ACTION_DONE_API]`: the ticks live on this phone until the API has a
  // field for them.
  useEffect(() => {
    let cancelled = false;
    const count = recording?.actionItems?.length ?? 0;
    if (!recording || count === 0) return;
    loadActionDone(recording.recordingId, count).then((flags) => {
      if (!cancelled) setDone(flags);
    });
    return () => { cancelled = true; };
  }, [recording]);

  /**
   * What a voice is called: the wearer's own name for it, else the label
   * the pipeline read off the conversation, else the diarizer's number.
   */
  const speakerName = useCallback(
    (index: number) =>
      recording?.speakers?.[String(index)]
      ?? recording?.speakerProfiles?.[String(index)]?.label
      ?? `Speaker ${index + 1}`,
    [recording],
  );

  const position = status?.currentTime ?? 0;
  const duration = status?.duration || recording?.durationSeconds || 0;

  // -- follow-along, the sweep and the reveal -----------------------------

  const scroller = useRef<ScrollView>(null);
  /** Where each transcript line sits inside the page, for the follow-along. */
  const lineTops = useRef(new Map<number, number>());
  /**
   * Where the transcript block starts inside the page. A line's own
   * `onLayout` reports a `y` relative to that block, not to the scroll
   * content — without this offset every scroll lands short by the height of
   * everything above the transcript.
   */
  const transcriptTop = useRef(0);
  const [viewport, setViewport] = useState(0);
  /** Suppresses the follow-along scroll while the reader is driving. */
  const userScrolling = useRef(false);
  const [revealed, setRevealed] = useState<ActionMatch | null>(null);

  const activeLine = useMemo(() => {
    if (!transcript) return -1;
    return transcript.utterances.findIndex((u) => position >= u.start && position < u.end);
  }, [transcript, position]);

  /** Puts a line in the top third of the page. */
  const bringIntoView = useCallback((index: number) => {
    const top = lineTops.current.get(index);
    if (top === undefined || !viewport) return;
    scroller.current?.scrollTo({
      y: Math.max(0, transcriptTop.current + top - viewport / 3),
      animated: true,
    });
  }, [viewport]);

  // The playhead leads the page only while audio is actually playing, and
  // never while the reader is scrolling it themselves.
  const lastFollowed = useRef(-1);
  useEffect(() => {
    if (!status?.playing || activeLine < 0) return;
    if (activeLine === lastFollowed.current || userScrolling.current) return;
    lastFollowed.current = activeLine;
    bringIntoView(activeLine);
  }, [activeLine, status?.playing, bringIntoView]);

  /**
   * `[ACTION_SOURCE]` — every commitment matched back to the line it came
   * from, once. The highlight under those words is the canvas' carbon span
   * (C2); no match means no highlight, because the wrong line marked is
   * worse than none.
   */
  const commitmentSpans = useMemo(() => {
    const spans = new Map<number, { from: number; to: number }>();
    if (!transcript || !recording?.actionItems?.length) return spans;
    for (const item of recording.actionItems) {
      const found = matchActionSource(item.text, transcript.utterances);
      if (found && !spans.has(found.utterance)) {
        spans.set(found.utterance, { from: found.from, to: found.to });
      }
    }
    return spans;
  }, [transcript, recording]);

  const revealSource = useCallback((text: string) => {
    const found = transcript ? matchActionSource(text, transcript.utterances) : null;
    if (!found) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      return;
    }
    setRevealed(found);
    bringIntoView(found.utterance);
  }, [transcript, bringIntoView]);

  /** The Ask sheet's `↳ 11:08` chips land here, one request at a time. */
  const seek = useSyncExternalStore(subscribeSeek, seekSnapshot, seekSnapshot);
  useEffect(() => {
    if (!seek || !transcript) return;
    const request = takeSeek(id);
    if (!request) return;
    if (audioUrl) player.seekTo(request.seconds);
    const at = transcript.utterances.findIndex(
      (u) => u.end > request.seconds && u.start <= request.seconds,
    );
    if (at >= 0) bringIntoView(at);
  }, [seek, transcript, id, audioUrl, player, bringIntoView]);

  // -- actions -------------------------------------------------------------

  const toggleDone = async (index: number) => {
    const next = [...done];
    next[index] = !next[index];
    setDone(next);
    if (recording) await saveActionDone(recording.recordingId, index, next[index]);
  };

  /** Switch the player to the untouched original, fetching its URL if needed. */
  const hearOriginal = async () => {
    try {
      let url = originalUrl;
      if (!url) {
        const res = await api.getAudioUrl(id, { raw: true });
        url = res.url;
        setOriginalUrl(url);
      }
      setAudioUrl(url);
      setVariant('original');
    } catch (err) {
      toast.show('Could not load the original', { detail: (err as Error).message, tone: 'error' });
    }
  };

  const cycleSpeed = () => {
    const next = (speed + 1) % SPEEDS.length;
    setSpeed(next);
    try {
      player.setPlaybackRate(SPEEDS[next]);
    } catch {
      // An engine that will not change rate keeps the one it has; the label
      // going back to 1.0× would be the lie.
      setSpeed(speed);
    }
  };

  /**
   * A rename re-files the conversation to memory with the names in it, which
   * is the only thing GitLoom lets a correction do (`[GL_SUPERSEDE]`). The
   * toast says exactly that, and the version on the facts card moves when
   * the server says it moved — not when the sheet closes.
   */
  const renameSpeaker = async (index: number, name: string) => {
    if (!recording) return;
    const speakers = { ...(recording.speakers ?? {}) };
    if (name.trim()) speakers[String(index)] = name.trim();
    else delete speakers[String(index)];

    setRecording({ ...recording, speakers });
    setRenaming(undefined);
    try {
      const updated = await api.patchRecording(recording.recordingId, { speakers });
      setRecording(updated);
      await loadRecordings();
      toast.show(CONVERSATION.renamed, { tone: 'success' });
    } catch (err) {
      toast.show('Could not save that name', { detail: (err as Error).message, tone: 'error' });
    }
  };

  const renameConversation = () => {
    if (!recording) return;
    Alert.prompt?.(
      'Rename this conversation',
      undefined,
      async (value: string) => {
        const title = value.trim();
        if (!title) return;
        setRecording({ ...recording, title });
        try {
          const updated = await api.patchRecording(recording.recordingId, { title });
          setRecording(updated);
          await loadRecordings();
        } catch (err) {
          toast.show('Could not rename it', { detail: (err as Error).message, tone: 'error' });
        }
      },
      'plain-text',
      recording.title ?? '',
    );
  };

  /**
   * Export is the words, not the audio: a transcript is what somebody wants
   * to paste into a mail, and the audio is a presigned URL that expires.
   */
  const exportTranscript = async () => {
    if (!recording) return;
    const header = [recording.title || CONVERSATION.untitled,
      `${formatDayStamp(recording.startedAt)} · ${clockSpan(recording.startedAt, duration)}`].join('\n');
    const body = (transcript?.utterances ?? [])
      .map((u) => `${wallClock(recording.startedAt, u.start)} ${speakerName(u.speaker)}: ${u.text}`)
      .join('\n');
    await Share.share({ message: body ? `${header}\n\n${body}` : header }).catch(() => undefined);
  };

  const remove = () =>
    Alert.alert(CONVERSATION.deleteTitle, CONVERSATION.deleteBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteRecording(id);
            await loadRecordings();
            toast.show('Conversation deleted');
            router.back();
          } catch (err) {
            toast.show('Could not delete', { detail: (err as Error).message, tone: 'error' });
          }
        },
      },
    ]);

  // -- states --------------------------------------------------------------

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <MarkPulse />
      </View>
    );
  }

  if (error || !recording) {
    // A failure with a way out of it. Without the button this screen was a
    // dead end that could only be left by going back and coming in again.
    return (
      <View className="flex-1">
        <TopRow back={CONVERSATION.back} onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center px-[22px] gap-[11px]">
          <Txt variant="statement" center>{CONVERSATION.couldNotOpen}</Txt>
          {error ? <Txt variant="bodyL" tone="muted" center>{error}</Txt> : null}
          <Button
            title={CONVERSATION.tryAgain}
            onPress={() => setAttempt((n) => n + 1)}
            className="mt-[4px]"
          />
        </View>
      </View>
    );
  }

  const pipeline = recording.status === 'failed'
    ? { label: CONVERSATION.failed, line: recording.error || CONVERSATION.failedLine }
    : PIPELINE[recording.status];

  /**
   * Canvas C1: this conversation is being made right now.
   *
   * True only when the pendant says it is recording *and* this row has not
   * been handed over yet. Anything looser would put a red strip on a
   * conversation that finished an hour ago.
   */
  const capturing = !!info?.recording
    && (link === 'connected' || link === 'syncing')
    && (recording.status === 'pending' || recording.status === 'uploaded');

  const points = summaryPoints(recording.summary);
  const facts = factsHeading(recording);
  const items = recording.actionItems ?? [];
  const language = languageChip(transcript?.language);

  // The account's tasks for this conversation, newest last so the card reads
  // in the order the promises were made. Where there are none — an older
  // conversation the enrichment pass never produced tasks for — the card
  // falls back to `actionItems` and the ticks this phone has been keeping.
  const tasksHere = allTasks
    .filter((t) => t.recordingId === recording.recordingId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const openCount = tasksHere.length
    ? tasksHere.filter(isOpen).length
    : items.filter((_, i) => !done[i]).length;
  const commitmentCount = tasksHere.length || items.length;

  const tickTask = async (task: Task) => {
    if (task.status === 'done') { router.push(`/task/${task.taskId}`); return; }
    try {
      const receipt = await markTaskDone(task.taskId);
      if (receipt) router.push(`/receipt/${receipt.receiptId}?printed=1`);
    } catch (err) {
      toast.show('That would not mark done', {
        detail: (err as Error).message, tone: 'error',
      });
    }
  };

  return (
    <View className="flex-1">
      <TopRow
        back={CONVERSATION.back}
        onBack={() => router.back()}
        right={
          <>
            <TopAction label={CONVERSATION.rename} onPress={renameConversation} />
            <TopAction label={CONVERSATION.exportLabel} onPress={exportTranscript} />
            <TopAction label={CONVERSATION.deleteLabel} tone="danger" onPress={remove} />
          </>
        }
      />

      <ScrollView
        ref={scroller}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 96, gap: 11 }}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => { userScrolling.current = true; }}
        onMomentumScrollEnd={() => { userScrolling.current = false; }}
        onScrollEndDrag={() => { userScrolling.current = false; }}
        scrollEventThrottle={32}
      >
        {/* -- what it was ---------------------------------------------- */}
        <View className="px-[4px] gap-[4px]">
          <Txt variant="title" tone={recording.title ? 'fg' : 'muted'}>
            {recording.title || CONVERSATION.untitled}
          </Txt>
          <Label variant="nav">
            {[
              formatDayStamp(recording.startedAt).toUpperCase(),
              clockSpan(recording.startedAt, duration),
              recording.speakerCount ? `${recording.speakerCount} SPEAKERS` : undefined,
              language,
            ]}
          </Label>
        </View>

        {/* -- C1: still being made -------------------------------------- */}
        {capturing ? (
          <CapturingStrip startedAt={recording.startedAt} />
        ) : pipeline ? (
          <Banner
            variant={recording.status === 'failed' ? 'void' : 'carbon'}
            label={[pipeline.label, pipeline.line]}
            action={recording.status === 'failed' ? CONVERSATION.retry : undefined}
            onAction={recording.status === 'failed' ? async () => {
              setRetrying(true);
              try {
                // The audio is still in S3; a retry only re-queues it.
                setRecording(await api.retryRecording(recording.recordingId));
                await loadRecordings();
                toast.show('Queued for transcription', { tone: 'success' });
              } catch (err) {
                toast.show('Could not retry', { detail: (err as Error).message, tone: 'error' });
              } finally {
                setRetrying(false);
              }
            } : undefined}
          />
        ) : null}
        {retrying ? <Label variant="eyebrow">QUEUEING…</Label> : null}

        {/* -- the player ----------------------------------------------- */}
        {audioUrl ? (
          <Player
            playing={!!status?.playing}
            position={position}
            duration={duration}
            speed={SPEEDS[speed]}
            onToggle={() => (status?.playing ? player.pause() : player.play())}
            onSeek={(fraction) => duration && player.seekTo(fraction * duration)}
            onJump={(seconds) => {
              // Clamped at both ends: seeking past the end stops playback on
              // some engines, and seeking to a negative second throws.
              const to = Math.max(0, Math.min(duration || 0, position + seconds));
              player.seekTo(to);
            }}
            onSpeed={cycleSpeed}
          />
        ) : null}

        {enhancedUrl ? (
          <View className="flex-row items-center gap-[7px]">
            <Chip
              label={CONVERSATION.enhanced}
              tone={variant === 'enhanced' ? 'stamp' : 'faint'}
              onPress={() => { setAudioUrl(enhancedUrl); setVariant('enhanced'); }}
            />
            <Chip
              label={CONVERSATION.original}
              tone={variant === 'original' ? 'stamp' : 'faint'}
              onPress={hearOriginal}
            />
            <Label variant="chip" className="flex-1" numberOfLines={1}>
              {variant === 'enhanced' ? CONVERSATION.enhancedNote : CONVERSATION.originalNote}
            </Label>
          </View>
        ) : null}

        {/* -- what you promised ----------------------------------------- */}
        {commitmentCount ? (
          <Card variant="carbon" className="gap-[11px]">
            <Label variant="eyebrow">
              {commitmentsHeading(commitmentCount, openCount) ?? ''}
            </Label>

            {tasksHere.length
              ? tasksHere.map((task) => (
                <Commitment
                  key={task.taskId}
                  text={task.text}
                  owner={task.owner !== null && task.owner !== undefined
                    ? speakerName(task.owner) : undefined}
                  state={task.status}
                  onToggle={() => void tickTask(task)}
                  onPress={() => router.push(`/task/${task.taskId}`)}
                />
              ))
              : items.map((item, i) => (
                <Commitment
                  key={`${i}-${item.text}`}
                  text={item.text}
                  owner={item.owner !== null && item.owner !== undefined
                    ? speakerName(item.owner) : undefined}
                  state={done[i] ? 'done' : 'proposed'}
                  onToggle={() => toggleDone(i)}
                  onPress={() => revealSource(item.text)}
                />
              ))}

            {/* Where the answer came from, said out loud: a task is the
                account's, a tick is this handset's (`[ACTION_DONE_API]`). */}
            <Label variant="chip">
              {tasksHere.length ? CONVERSATION.commitmentsFromTasks : CONVERSATION.savedOnPhone}
            </Label>
          </Card>
        ) : null}

        {/* -- what it meant --------------------------------------------- */}
        {points.length ? (
          <Card className="gap-[11px]">
            <View className="flex-row justify-between items-baseline gap-[10px]">
              <Label variant="eyebrow">{summaryHeading(points.length)}</Label>
              {duration > 0 ? (
                <Label variant="chip">{`${formatSpan(duration)} → ${Math.max(10, points.length * 5)} SEC`}</Label>
              ) : null}
            </View>
            <View className="gap-[9px]">
              {points.map((point, i) => (
                <View key={point} className="flex-row gap-[9px]">
                  <Label variant="value" tone="stamp">{String(i + 1).padStart(2, '0')}</Label>
                  <Txt variant="small" className="flex-1">{point}</Txt>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* -- what it taught -------------------------------------------- */}
        {facts ? (
          <Card className="gap-[11px]">
            <Label variant="eyebrow">{facts.heading}</Label>
            {facts.hasFacts ? (
              <View className="gap-[10px]">
                {(recording.facts ?? []).map((fact) => (
                  <View key={fact.text} className="gap-[3px]">
                    <Label variant="chip" tone="stamp">{factKind(fact.kind)}</Label>
                    <Txt variant="small">{fact.text}</Txt>
                  </View>
                ))}
              </View>
            ) : (
              <Txt variant="small" tone="muted">
                This conversation reached your memory. What it made of it is not
                listed back to us, so nothing here claims a number.
              </Txt>
            )}
            {facts.footer ? <Label variant="chip">{facts.footer}</Label> : null}
          </Card>
        ) : null}

        {/* -- every word of it ------------------------------------------ */}
        {transcript?.utterances.length ? (
          <View
            className="px-[4px] gap-[11px] mt-[7px]"
            onLayout={(e: LayoutChangeEvent) => {
              transcriptTop.current = e.nativeEvent.layout.y;
            }}
          >
            <Label variant="eyebrow">{CONVERSATION.transcript}</Label>
            {transcript.utterances.map((utterance, i) => {
              const opensRun = i === 0 || transcript.utterances[i - 1].speaker !== utterance.speaker;
              return (
                <View
                  key={i}
                  onLayout={(e: LayoutChangeEvent) => lineTops.current.set(i, e.nativeEvent.layout.y)}
                >
                  <Line
                    time={wallClock(recording.startedAt, utterance.start)}
                    speaker={opensRun ? speakerName(utterance.speaker).toUpperCase() : undefined}
                    text={utterance.text}
                    span={commitmentSpans.get(i)}
                    revealed={revealed?.utterance === i}
                    active={i === activeLine}
                    onPress={() => audioUrl && player.seekTo(utterance.start)}
                    onRename={opensRun ? () => setRenaming(utterance.speaker) : undefined}
                  />
                </View>
              );
            })}
          </View>
        ) : capturing ? null : recording.status === 'ready' ? (
          <Txt variant="small" tone="faint">{CONVERSATION.noSpeechFound}</Txt>
        ) : null}
      </ScrollView>

      {/* Canvas C2: the one live action, bottom right, over everything. */}
      <Touchable
        onPress={() => router.push(`/recording/${id}/ask`)}
        accessibilityRole="button"
        accessibilityLabel="ask lyzn about this conversation"
        className="absolute right-[20px] flex-row items-center gap-[9px] bg-tone-inv-bg py-[14px] px-[17px]"
        style={{ bottom: insets.bottom + 20 }}
      >
        <Icon.MessageSquare className="w-[15px] h-[15px] text-tone-inv-fg" />
        <Label variant="button" tone="inv">{CONVERSATION.askLyzn}</Label>
      </Touchable>

      <RenameSheet
        index={renaming}
        current={renaming !== undefined ? speakerName(renaming) : ''}
        named={renaming !== undefined ? recording?.speakers?.[String(renaming)] : undefined}
        description={renaming !== undefined ? recording?.speakerProfiles?.[String(renaming)]?.description : undefined}
        onCancel={() => setRenaming(undefined)}
        onSave={renameSpeaker}
      />
    </View>
  );
}

// -- pieces ----------------------------------------------------------------

/**
 * Canvas C1's header, in the one honest form the app can draw it: this
 * conversation started at a time the row knows, the pendant says it is still
 * recording, and the transcript is not written yet.
 */
function CapturingStrip({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const started = new Date(startedAt).getTime();
  const elapsed = Number.isNaN(started) ? 0 : Math.max(0, (now - started) / 1000);

  return (
    <Card variant="void" className="gap-[9px]">
      <View className="flex-row items-center gap-[11px]">
        <View className="w-[9px] h-[9px] rounded-full bg-tone-danger" />
        <Label variant="action" tone="danger" className="flex-1">{CONVERSATION.capturing}</Label>
        <Label variant="loud" tone="danger">{formatClock(elapsed)}</Label>
      </View>
      <Txt variant="small" tone="muted">{CONVERSATION.capturingLine}</Txt>
      <Label variant="eyebrow">{CONVERSATION.transcribing}</Label>
    </Card>
  );
}

/**
 * The player card — canvas C2: one round ink button, a 3 px rule, and the
 * three numbers under it.
 *
 * The bar is the kit's `Progress` inside this screen's own responder: the
 * kit paints, the screen decides what a touch at 38 % means.
 */
function Player({ playing, position, duration, speed, onToggle, onSeek, onJump, onSpeed }: {
  playing: boolean;
  position: number;
  duration: number;
  speed: number;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  /** Signed: negative goes back. The screen clamps it against the duration. */
  onJump: (seconds: number) => void;
  onSpeed: () => void;
}) {
  const width = useRef(0);
  const fractionAt = (event: GestureResponderEvent) =>
    width.current ? Math.max(0, Math.min(1, event.nativeEvent.locationX / width.current)) : 0;

  return (
    <Card className="flex-row items-center gap-[12px]">
      {/* The two jumps sit either side of the transport, which is where a
          thumb expects them. They are mono labels rather than glyphs: the
          number is the whole of what they promise. */}
      <Touchable
        onPress={() => onJump(-JUMP_SECONDS)}
        hitSlop={10}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="back fifteen seconds"
      >
        <Label variant="value" tone="fg">{CONVERSATION.back15}</Label>
      </Touchable>

      <Touchable
        onPress={onToggle}
        haptic="medium"
        accessibilityRole="button"
        accessibilityLabel={playing ? 'pause' : 'play'}
        className="w-[34px] h-[34px] rounded-full bg-tone-inv-bg items-center justify-center"
      >
        {playing
          ? <Icon.Pause className="w-[14px] h-[14px] text-tone-inv-fg" />
          : <Icon.Play className="w-[14px] h-[14px] text-tone-inv-fg" />}
      </Touchable>

      <Touchable
        onPress={() => onJump(JUMP_SECONDS)}
        hitSlop={10}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="forward fifteen seconds"
      >
        <Label variant="value" tone="fg">{CONVERSATION.forward15}</Label>
      </Touchable>

      <View className="flex-1 gap-[7px]">
        <View
          className="py-[8px] -my-[8px]"
          onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
          onStartShouldSetResponder={() => true}
          onResponderRelease={(event) => onSeek(fractionAt(event))}
          accessibilityRole="adjustable"
          accessibilityLabel="seek"
        >
          <Progress value={duration ? position / duration : 0} tone="ink" />
        </View>
        <View className="flex-row justify-between items-baseline">
          <Label variant="value">{formatClock(position)}</Label>
          <Touchable
            onPress={onSpeed}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="playback speed"
          >
            <Label variant="value" tone="fg">{`${speed.toFixed(2).replace(/0$/, '')}×`}</Label>
          </Touchable>
          <Label variant="value">{formatClock(duration)}</Label>
        </View>
      </View>
    </Card>
  );
}

/**
 * One commitment inside the carbon card — canvas C2's `DONE ✓` / `OPEN`
 * rows, now carrying the task's own status.
 *
 * `dismissed` gets its own word rather than being drawn as open: a promise
 * somebody dropped is settled, and showing it as still owed would be the
 * card claiming work that nobody is going to do.
 */
const COMMITMENT_TAG: Record<string, { label: string; tone: 'settled' | 'stamp' | 'faint' | 'danger' }> = {
  proposed: { label: 'OPEN', tone: 'stamp' },
  approved: { label: 'APPROVED', tone: 'stamp' },
  done: { label: 'DONE ✓', tone: 'settled' },
  dismissed: { label: 'DROPPED', tone: 'faint' },
  failed: { label: 'STOPPED', tone: 'danger' },
};

function Commitment({ text, owner, state, onToggle, onPress }: {
  text: string;
  owner?: string;
  state: string;
  onToggle: () => void;
  onPress: () => void;
}) {
  const tag = COMMITMENT_TAG[state] ?? COMMITMENT_TAG.proposed;
  const settled = state === 'done' || state === 'dismissed';
  return (
    <View className="flex-row gap-[10px] items-start">
      <Touchable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: state === 'done' }}
        accessibilityLabel={text}
      >
        <Label variant="tag" tone={tag.tone}>{tag.label}</Label>
      </Touchable>
      <Touchable
        onPress={onPress}
        scaleTo={1}
        accessibilityRole="button"
        accessibilityLabel={text}
        className="flex-1 gap-[2px]"
      >
        <Txt variant="strong" tone={settled ? 'muted' : 'fg'}>{text}</Txt>
        {owner ? <Label variant="chip">{owner}</Label> : null}
      </Touchable>
    </View>
  );
}

/**
 * One transcript line — canvas C2: a wall-clock column, the speaker's name
 * over the first line of their run, and the commitment span in carbon.
 *
 * The highlight is a nested `Text`, not a view behind the words: the span is
 * inside a sentence, and only inline text can wrap with it.
 */
function Line({ time, speaker, text, span, revealed, active, onPress, onRename }: {
  time: string;
  speaker?: string;
  text: string;
  span?: { from: number; to: number };
  revealed: boolean;
  active: boolean;
  onPress: () => void;
  onRename?: () => void;
}) {
  const body = span ? (
    <>
      {text.slice(0, span.from)}
      <Text className={cx('bg-tone-carbon', revealed && 'text-tone-stamp')}>
        {text.slice(span.from, span.to)}
      </Text>
      {text.slice(span.to)}
    </>
  ) : text;

  return (
    <View className="flex-row gap-[11px]">
      <Label variant="chip" className="w-[38px]" numberOfLines={1}>{time}</Label>
      <View className="flex-1 gap-[3px]">
        {speaker ? (
          <Touchable
            onPress={onRename}
            disabled={!onRename}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`rename ${speaker.toLowerCase()}`}
          >
            <Label variant="tag" tone={active ? 'fg' : 'faint'}>{speaker}</Label>
          </Touchable>
        ) : null}
        <Touchable onPress={onPress} scaleTo={1} haptic="none" accessibilityLabel={text}>
          <Txt variant="bodyL" tone={active ? 'fg' : 'muted'}>{body}</Txt>
        </Touchable>
      </View>
    </View>
  );
}

/**
 * The speaker sheet, and the one thing a rename honestly promises.
 *
 * `named` is the wearer's own name for this voice, if they gave one; `current`
 * is whatever the transcript shows for it, which may be the pipeline's guessed
 * label. Only a name the wearer typed pre-fills the field: a guessed label
 * stays a placeholder, so saving the sheet untouched never files that guess
 * to memory under the wearer's name.
 */
function RenameSheet({ index, current, named, description, onCancel, onSave }: {
  index?: number;
  current: string;
  named?: string;
  description?: string;
  onCancel: () => void;
  onSave: (index: number, name: string) => void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(named ?? '');
  }, [named, index]);

  return (
    <Sheet
      visible={index !== undefined}
      onClose={onCancel}
      title="NAME THIS SPEAKER"
      icon={Icon.Pencil}
      context={description ? `${description} ${CONVERSATION.nameSpeakerLine}` : CONVERSATION.nameSpeakerLine}
    >
      <View className="px-[20px] pt-[16px] pb-[12px] gap-[11px]">
        <Field
          value={value}
          onChangeText={setValue}
          placeholder={current}
          autoFocus
        />
        <Label variant="chip">{CONVERSATION.renamed.toUpperCase()}</Label>
        <View className="flex-row gap-[8px]">
          <Button variant="secondary" title="Cancel" onPress={onCancel} className="flex-1" />
          <Button
            title="Save"
            onPress={() => index !== undefined && onSave(index, value)}
            className="flex-1"
          />
        </View>
      </View>
    </Sheet>
  );
}
