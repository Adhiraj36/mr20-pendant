/**
 * Home — canvas H1, with S3's empties and S1/P2/P3's banner slot.
 *
 * The record of a day, on the desk: what was said, what came out of it, and
 * what is still waiting on you. Three segments over one screen —
 * CONVERSATIONS is this file, TASKS and RECEIPTS are T8's, rendered here
 * through the shape both branches agreed on.
 *
 * Everything the previous Library did, it still does (research §2, "Library"):
 * load on mount, reconnect and flush uploads on focus, poll every 15 s while
 * anything is mid-pipeline, pull to refresh, page on scroll, long-press to
 * select, batch delete and categorise behind their alerts. What changed is
 * the surface — kit components on the desk instead of receipts on paper —
 * and one thing that went: the print queue. A conversation no longer prints
 * itself as a slip when it finishes; receipts are their own segment now, and
 * a conversation is a conversation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, SectionList, ScrollView, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarPadding } from '../../src/design/useTabBarPadding';
import {
  Screen, ToneProvider, Txt, Label, Card, Chip, Banner, EmptyCard, Button, Segments,
  ConversationRow, RecordingPill, Touchable, Icon, useToast, useTone, useTheme,
  type IconComponent,
} from '../../src/design/kit';
import { useApp, flushUploads } from '../../src/state/store';
import { useTasks, useTaskGroups, useWaitingCount } from '../../src/state/tasks';
import { isOpen } from '../../src/tasks/models';
import { type Category, type Recording } from '../../src/api/client';
import { groupByDay, formatTimeOfDay, formatSpan } from '../../src/recordings/grouping';
import { conversationChips, homeMeta } from '../../src/recordings/conversation';
import { loadDoneCounts } from '../../src/recordings/actionDone';
import { useFeatures } from '../../src/home/features';
import { useDaemons } from '../../src/daemon/useDaemons';
import { daemonBanner, offersPairing } from '../../src/daemon/model';
import { TasksSegment } from '../../src/home/TasksSegment';
import { ReceiptsSegment } from '../../src/home/ReceiptsSegment';
import { clearBadge } from '../../src/notifications/push';
import { HOME } from '../../src/design/copy';

/** The three lists behind the one screen. The value is the route param. */
type Segment = 'conversations' | 'tasks' | 'receipts';

const SEGMENTS: Segment[] = ['conversations', 'tasks', 'receipts'];

function asSegment(raw: unknown): Segment {
  return SEGMENTS.includes(raw as Segment) ? (raw as Segment) : 'conversations';
}

/** Which shelf of conversations: everything, one category, or the archive. */
type Filter = 'all' | 'archive' | { categoryId: string };

/** Below this fraction of the pendant's storage, the banner appears. */
const STORAGE_LOW = 0.1;

export default function Home() {
  return (
    <Screen>
      <HomePage />
    </Screen>
  );
}

function HomePage() {
  const router = useRouter();
  const t = useTone();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const bottomPad = useTabBarPadding();
  const features = useFeatures();

  // The segment lives in the URL so a notification, a deep link and the back
  // stack can all name one (`/(tabs)?segment=tasks`, plan §2.5).
  const params = useLocalSearchParams<{ segment?: string }>();
  const segment = asSegment(params.segment);
  const setSegment = useCallback(
    (next: Segment) => router.setParams({ segment: next }),
    [router],
  );

  const {
    recordings, loadingRecordings, loadRecordings, loadMoreRecordings,
    loadingMoreRecordings, recordingsCursor, recordingsError,
    deleteRecordings, categorizeRecordings,
    paired, link, info, connect, sync, categories, loadCategories,
  } = useApp();

  // The tasks live in their own store, and the count on the segment is the
  // API's answer rather than an arithmetic over `actionItems` — see `waiting`
  // below for what that used to be and why it was wrong.
  const loadTasks = useTasks((s) => s.loadTasks);
  const loadReceipts = useTasks((s) => s.loadReceipts);
  const allTasks = useTasks((s) => s.tasks);
  const waitingCount = useWaitingCount();
  const taskGroups = useTaskGroups();

  /**
   * The laptop that carries out approved work, and whether to say anything
   * about it. `daemonBanner` answers "nothing" for every ordinary state,
   * including the common one where a laptop is shut and nothing is waiting.
   */
  const { daemons, loading: daemonsLoading } = useDaemons();
  const approvedCount = useTasks((s) => s.tasks.filter((t) => t.status === 'approved').length);
  const laptop = useMemo(
    () => daemonBanner({
      enabled: offersPairing(features),
      loaded: !daemonsLoading,
      daemons,
      approved: approvedCount,
      now: new Date(),
      words: {
        none: HOME.daemonNone, pair: HOME.daemonPair,
        asleep: HOME.daemonAsleep, see: HOME.daemonFix,
      },
    }),
    [features, daemonsLoading, daemons, approvedCount],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  /** Non-null = selection mode; holds the picked ids. */
  const [selected, setSelected] = useState<Set<string> | null>(null);

  // Selecting is a conversations gesture — the ids it holds are recording ids,
  // and its bar is pinned to the window rather than drawn inside the list. So
  // leaving the segment has to end it, or the bar rides over TASKS and
  // RECEIPTS offering to move and delete conversations that are no longer on
  // screen.
  useEffect(() => {
    if (segment !== 'conversations') setSelected(null);
  }, [segment]);
  const [acting, setActing] = useState(false);
  /** How many of each conversation's commitments are ticked, from this phone. */
  const [doneCounts, setDoneCounts] = useState<Record<string, number>>({});

  // Tasks are loaded here and not only by the TASKS segment: the segment
  // label carries the count, and a count that only becomes true once you
  // have opened the thing it counts is not a count.
  useEffect(() => {
    loadRecordings();
    loadCategories();
    loadTasks();
  }, [loadRecordings, loadCategories, loadTasks]);

  // Reconnecting on focus is what makes "wear it, come back, it is there" work.
  // The badge is cleared here for the same reason it is set: it counts what is
  // waiting to be *seen*, and this is the screen where it is seen.
  useFocusEffect(
    useCallback(() => {
      if (paired && link === 'disconnected') connect().catch(() => undefined);
      flushUploads().catch(() => undefined);
      clearBadge().catch(() => undefined);
    }, [paired, link, connect]),
  );

  // Anything mid-pipeline resolves server-side within a minute or two — and
  // what it resolves into is a summary, some facts and a row of tasks, so the
  // poll fetches both or the TASKS segment stays a beat behind the list.
  useEffect(() => {
    const working = recordings.some((r) => r.status === 'processing' || r.status === 'uploaded');
    if (!working) return;
    const timer = setInterval(() => {
      loadRecordings();
      loadTasks();
    }, 15_000);
    return () => clearInterval(timer);
  }, [recordings, loadRecordings, loadTasks]);

  // `[ACTION_DONE_API]`: the phone's own ticks, still the only record for a
  // conversation whose commitments the enrichment pass never turned into
  // tasks. Where there *are* tasks, `taskCounts` below wins — a task carries
  // the account's answer and a tick carries this handset's.
  useEffect(() => {
    let cancelled = false;
    loadDoneCounts(recordings).then((counts) => { if (!cancelled) setDoneCounts(counts); });
    return () => { cancelled = true; };
  }, [recordings]);

  /** Open and settled per conversation, from the tasks the account holds. */
  const taskCounts = useMemo(() => {
    const counts: Record<string, { open: number; done: number }> = {};
    for (const task of allTasks) {
      if (!task.recordingId) continue;
      const row = counts[task.recordingId] ?? { open: 0, done: 0 };
      if (isOpen(task)) row.open += 1;
      else if (task.status === 'done') row.done += 1;
      counts[task.recordingId] = row;
    }
    return counts;
  }, [allTasks]);

  const categoryName = useCallback(
    (id?: string | null) => categories.find((c) => c.id === id)?.name,
    [categories],
  );

  const live = useMemo(() => recordings.filter((r) => r.status !== 'archived'), [recordings]);

  const usedCategories = useMemo(
    () => categories.filter((c) => live.some((r) => r.categoryId === c.id)),
    [categories, live],
  );
  const archivedCount = useMemo(
    () => recordings.filter((r) => r.status === 'archived').length,
    [recordings],
  );

  const shown = useMemo(() => {
    if (filter === 'archive') return recordings.filter((r) => r.status === 'archived');
    if (filter === 'all') return live;
    return live.filter((r) => r.categoryId === filter.categoryId);
  }, [recordings, live, filter]);

  const sections = useMemo(
    () => groupByDay(shown).map((group) => ({ ...group, data: group.items })),
    [shown],
  );

  /**
   * What is still waiting on you — `GET /tasks`, and nothing else.
   *
   * This used to be `actionItems` minus a per-phone tick count, which was a
   * guess in two directions at once: it counted commitments the backend had
   * already turned into tasks and then dismissed, and it missed every task
   * whose recording had scrolled off the first page. The tasks API is the
   * only thing that knows, so the segment's number and this card's list are
   * both read straight off it (round eight).
   */
  const waiting = taskGroups.open;

  // -- the pendant's own two banners --------------------------------------

  const recordingNow = !!info?.recording && (link === 'connected' || link === 'syncing');
  const freeFraction = info?.totalMb ? (info.freeMb ?? 0) / info.totalMb : undefined;
  const storageFull = freeFraction !== undefined && freeFraction <= 0;
  const storageLow = freeFraction !== undefined && freeFraction > 0 && freeFraction < STORAGE_LOW;
  const outOfRange = !!paired && link !== 'connected' && link !== 'syncing' && link !== 'connecting';

  // -- selection ----------------------------------------------------------

  const toggleSelect = (id: string) =>
    setSelected((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const batchDelete = () => {
    if (!selected?.size) return;
    Alert.alert(
      `Delete ${selected.size} ${selected.size === 1 ? 'conversation' : 'conversations'}?`,
      'Audio and transcripts are deleted from your account. The pendant may still hold its own copies.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setActing(true);
            // The rows go now and come back if the account refuses them; the
            // toast names what did not go through rather than a bare count.
            const { deleted, failed } = await deleteRecordings([...selected]);
            setActing(false);
            setSelected(null);
            if (failed.length) {
              toast.show(HOME.deleteFailed(failed.length), {
                detail: deleted ? `${deleted} did` : undefined,
                tone: 'error',
              });
            } else {
              toast.show(`Deleted ${deleted} ${deleted === 1 ? 'conversation' : 'conversations'}`);
            }
          },
        },
      ],
    );
  };

  const batchMove = async (categoryId: string | null) => {
    if (!selected?.size) return;
    setActing(true);
    const { moved, failed } = await categorizeRecordings([...selected], categoryId);
    setActing(false);
    setSelected(null);
    if (failed.length) {
      toast.show(HOME.moveFailed(failed.length), {
        detail: moved ? `${moved} did` : undefined,
        tone: 'error',
      });
    } else {
      toast.show(`Moved ${moved} ${moved === 1 ? 'conversation' : 'conversations'}`);
    }
  };

  /**
   * Pull to refresh: everything this screen shows, from the source that owns
   * it.
   *
   * A sync pass reloads the recordings itself, but it says nothing about the
   * tasks, the receipts or the categories — all three are on the same screen
   * behind the same gesture, and a refresh that only refreshes a third of what
   * is on screen is the kind of thing people stop trusting.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const server = Promise.all([
      loadRecordings(),
      loadTasks({ reset: true }),
      loadReceipts({ reset: true }),
      loadCategories(),
    ]);
    if (link === 'connected') {
      // The latest is on the pendant too, not just on the server.
      await sync().catch(() => undefined);
    } else {
      await flushUploads().catch(() => undefined);
    }
    await server;
    setRefreshing(false);
  }, [link, sync, loadRecordings, loadTasks, loadReceipts, loadCategories]);

  const openRecording = (id: string) => router.push(`/recording/${id}`);

  // -- the chrome ---------------------------------------------------------

  const banners = (
    <>
      {/* The laptop, and only when there is a reason to mention it: work
          somebody approved, and no machine awake to take it. */}
      {laptop ? (
        <Banner
          variant="carbon"
          label={laptop.label}
          action={laptop.action}
          onAction={() => router.push('/settings/daemon')}
        />
      ) : null}
      {storageFull ? (
        <Banner variant="void" label={HOME.storageFull} action={HOME.sync} onAction={() => sync()} />
      ) : storageLow ? (
        <Banner variant="carbon" label={HOME.storageLow} action={HOME.sync} onAction={() => sync()} />
      ) : null}
      {outOfRange ? (
        <Banner
          variant="carbon"
          label={HOME.outOfRange}
          action={HOME.connect}
          onAction={() => connect().catch(() => undefined)}
        />
      ) : null}
      {/* The account could not be reached. Whatever is below this banner is
          still true — it is only no longer fresh — so this is drawn over the
          list rather than instead of it, and it offers the one thing that
          could change the answer. */}
      {recordingsError ? (
        <Banner
          variant="void"
          label={[HOME.offline, recordingsError]}
          action={HOME.retry}
          onAction={() => { loadRecordings(); loadTasks(); }}
        />
      ) : null}
    </>
  );

  const header = (
    <>
      <View className="flex-row justify-between items-start px-[22px] pt-[10px] pb-[14px]">
        <View>
          <Txt variant="screen">{HOME.title}</Txt>
          <Label variant="back" className="mt-[4px]">{homeMeta(live.length)}</Label>
        </View>
        <View className="flex-row gap-[9px]">
          {segment === 'conversations' && recordings.length ? (
            <RoundAction
              label={selected ? HOME.selectDone : HOME.select}
              icon={Icon.SquareCheck}
              active={!!selected}
              onPress={() => setSelected(selected ? null : new Set())}
            />
          ) : null}
          <RoundAction
            label="SETTINGS"
            icon={Icon.Settings}
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>

      <Segments
        className="mx-[18px] mb-[14px]"
        value={segment}
        onChange={setSegment}
        options={[
          { value: 'conversations' as const, label: HOME.segments.conversations },
          {
            value: 'tasks' as const,
            // `waitingCount` is the tasks store's own selector over what the
            // API returned: open plus failed, which is everything still on you.
            label: waitingCount
              ? `${HOME.segments.tasks} · ${waitingCount}`
              : HOME.segments.tasks,
          },
          { value: 'receipts' as const, label: HOME.segments.receipts },
        ]}
      />
    </>
  );

  const conversationsHeader = (
    <View className="gap-[11px] pb-[11px]">
      {recordingNow ? (
        <RecordingPill
          label={HOME.recording}
          detail="Now"
          onPress={() => router.push('/(tabs)/pendant')}
        />
      ) : null}

      {waiting.length ? (
        <Card
          variant="carbon"
          onPress={() => setSegment('tasks')}
          accessibilityLabel={`${waiting.length} tasks waiting on you`}
          className="flex-row items-center gap-[12px]"
        >
          <View className="flex-1 gap-[4px]">
            <Label variant="action">
              {`${waiting.length} ${waiting.length === 1 ? 'TASK' : 'TASKS'} WAITING ON YOU`}
            </Label>
            <Txt variant="strong" numberOfLines={1}>
              {waiting.slice(0, 2).map((task) => task.text).join(' · ')}
            </Txt>
          </View>
          <View className="bg-tone-inv-bg py-[10px] px-[12px]">
            <Label variant="action" tone="inv">{HOME.review}</Label>
          </View>
        </Card>
      ) : null}

      {recordings.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingVertical: 2 }}
        >
          <Chip
            label={HOME.all}
            tone={filter === 'all' ? 'stamp' : 'faint'}
            onPress={() => setFilter('all')}
          />
          {usedCategories.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.name.toUpperCase()}
              tone={typeof filter === 'object' && filter.categoryId === cat.id ? 'stamp' : 'faint'}
              onPress={() => setFilter({ categoryId: cat.id })}
            />
          ))}
          {archivedCount ? (
            <Chip
              label={`${HOME.archive} · ${archivedCount}`}
              tone={filter === 'archive' ? 'stamp' : 'faint'}
              onPress={() => setFilter('archive')}
            />
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );

  const segmentProps = {
    onOpenTask: (id: string) => router.push(`/task/${id}`),
    // A receipt that has just been printed says so, and prints itself once.
    onOpenReceipt: (id: string, options?: { printed?: boolean }) =>
      router.push(`/receipt/${id}${options?.printed ? '?printed=1' : ''}`),
  };

  return (
    <View className="flex-1">
      {banners}

      {segment === 'conversations' ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.recordingId}
          stickySectionHeadersEnabled
          // Rows are virtualised and their cells are pure: without this, a
          // selection change re-renders the list and not the rows that read it.
          extraData={{ selected, categories, doneCounts, taskCounts }}
          contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 18 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => loadMoreRecordings()}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.faint} />
          }
          ListHeaderComponent={
            <View className="-mx-[18px]">
              {header}
              <View className="px-[18px]">{conversationsHeader}</View>
            </View>
          }
          renderSectionHeader={({ section }) => (
            // The sticky heading paints its own ground, or the rows scroll
            // through it.
            <View className="pt-[18px] pb-[9px]" style={{ backgroundColor: t.bg }}>
              <Label variant="eyebrow">{[section.heading.toUpperCase(), section.meta]}</Label>
            </View>
          )}
          ItemSeparatorComponent={() => <View className="h-[11px]" />}
          renderItem={({ item }) => (
            <Row
              recording={item}
              categoryName={categoryName(item.categoryId)}
              tasks={taskCounts[item.recordingId]}
              done={doneCounts[item.recordingId] ?? 0}
              selected={selected ? selected.has(item.recordingId) : undefined}
              onPress={() =>
                selected ? toggleSelect(item.recordingId) : openRecording(item.recordingId)}
              onLongPress={() => { if (!selected) setSelected(new Set([item.recordingId])); }}
            />
          )}
          ListFooterComponent={
            loadingMoreRecordings ? (
              <Label variant="eyebrow" className="py-[22px]">LOADING…</Label>
            ) : recordingsCursor ? <View className="h-[22px]" /> : null
          }
          ListEmptyComponent={
            loadingRecordings ? null : (
              <Empties
                filter={filter}
                paired={!!paired}
                onPair={() => router.push('/onboarding/pair')}
              />
            )
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 18 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.faint} />
          }
          // Both segments page through a cursor, and both are blocks inside
          // this one scroller — so reaching the bottom here is what asks for
          // the next page, and each segment decides whether it has one.
          scrollEventThrottle={64}
          onScroll={({ nativeEvent: e }) => {
            const atEnd = e.layoutMeasurement.height + e.contentOffset.y
              >= e.contentSize.height - 260;
            if (!atEnd) return;
            if (segment === 'tasks') void useTasks.getState().loadMoreTasks();
            else void useTasks.getState().loadMoreReceipts();
          }}
        >
          <View className="-mx-[18px]">{header}</View>
          {segment === 'tasks'
            ? <TasksSegment {...segmentProps} />
            : <ReceiptsSegment {...segmentProps} />}
        </ScrollView>
      )}

      {/* The effect above clears the selection on the way out, but effects run
          after the render that switched the segment — without this guard the
          bar paints one frame over the new one. */}
      {segment === 'conversations' && selected ? (
        <SelectionBar
          count={selected.size}
          all={selected.size === shown.length && shown.length > 0}
          categories={categories}
          busy={acting}
          bottomPad={bottomPad}
          onToggleAll={() =>
            setSelected(
              selected.size === shown.length && shown.length
                ? new Set()
                : new Set(shown.map((r) => r.recordingId)),
            )}
          onMove={batchMove}
          onDelete={batchDelete}
        />
      ) : null}
    </View>
  );
}

// -- pieces ----------------------------------------------------------------

/** The two 38 pt round buttons in H1's top-right corner. */
function RoundAction({ label, icon: Glyph, active, onPress }: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      accessibilityState={{ selected: !!active }}
      className={[
        'w-[38px] h-[38px] rounded-full border-[1.5px] items-center justify-center',
        active ? 'bg-tone-inv-bg border-tone-line2' : 'bg-tone-panel border-tone-line',
      ].join(' ')}
    >
      <Glyph className={`w-[16px] h-[16px] ${active ? 'text-tone-inv-fg' : 'text-tone-fg'}`} />
    </Touchable>
  );
}

/**
 * One conversation, as the canvas draws it (H1): when it happened and how
 * long it ran, its title, two lines of what it was about, and the chips that
 * say what came out of it.
 *
 * A conversation still being made says so instead of showing a summary it
 * does not have, and a failed one carries the one fragment of its meta line
 * that is not faint.
 */
function Row({ recording, categoryName, tasks, done, selected, onPress, onLongPress }: {
  recording: Recording;
  categoryName?: string;
  /** What the account says about this conversation's promises, when it says anything. */
  tasks?: { open: number; done: number };
  done: number;
  /** undefined = not selecting; boolean = selecting, and whether this row is in. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const working = recording.status === 'processing' || recording.status === 'uploaded'
    || recording.status === 'pending' || recording.status === 'transcribed';
  const failed = recording.status === 'failed';

  // The account's tasks are the truth where there are any; the phone's own
  // ticks over `actionItems` stand in for a conversation the enrichment pass
  // never produced tasks for.
  const found = recording.actionItems?.length ?? 0;
  const chips = conversationChips({
    // `GET /recordings` carries no language — only the transcript does — so
    // the language chip belongs to the detail, where it is known.
    commitments: tasks ? tasks.open : found - done,
    done: tasks ? tasks.done : done,
  });

  const title = recording.title || (working ? 'Still being written up' : 'Untitled conversation');

  return (
    // The press and the long press are one gesture responder around a
    // passive card: `ConversationRow` takes a press, and selection needs the
    // other half of the same box.
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={1}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={selected !== undefined ? { selected } : undefined}
    >
      <ConversationRow
        when={formatTimeOfDay(recording.startedAt)}
        place={categoryName?.toUpperCase()}
        duration={recording.durationSeconds > 0 ? formatSpan(recording.durationSeconds) : undefined}
        title={title}
        summary={
          recording.summary
          || (working ? 'The transcript lands here about a minute after it ends.' : undefined)
        }
        chips={chips}
        className={selected ? 'border-[1.5px] border-tone-stamp' : undefined}
      />
      {failed ? (
        <Label variant="tag" tone="danger" className="mt-[5px]">
          {['FAILED', recording.error]}
        </Label>
      ) : null}
    </Touchable>
  );
}

/** Canvas S3: real copy, no "nothing here yet". */
function Empties({ filter, paired, onPair }: {
  filter: Filter;
  paired: boolean;
  onPair: () => void;
}) {
  if (filter === 'archive') {
    return <EmptyCard {...HOME.empty.archive} />;
  }
  if (filter !== 'all') {
    return <EmptyCard {...HOME.empty.filtered} />;
  }
  if (!paired) {
    return <EmptyCard {...HOME.empty.unpaired} onAction={onPair} />;
  }
  return <EmptyCard {...HOME.empty.conversations} />;
}

/** The selection bar: ink, pinned above the tab bar (canvas T1's own strip). */
function SelectionBar({
  count, all, categories, busy, bottomPad, onToggleAll, onMove, onDelete,
}: {
  count: number;
  all: boolean;
  categories: Category[];
  busy: boolean;
  bottomPad: number;
  onToggleAll: () => void;
  onMove: (categoryId: string | null) => void;
  onDelete: () => void;
}) {
  // The strip is the opposite ground, not the same ground with inverted
  // classes: everything inside it — a secondary button's outline, a chip's
  // hairline — then reads its own tone and is correct without a single
  // component needing an "on ink" variant.
  const { ground } = useTheme();

  return (
    <ToneProvider
      ground={ground === 'night' ? 'desk' : 'night'}
      className="absolute left-0 right-0 bottom-0 px-[18px] pt-[14px] gap-[11px]"
      style={{ paddingBottom: bottomPad, backgroundColor: ground === 'night' ? '#E3E4DE' : '#1C1C16' }}
    >
      <View className="flex-row justify-between items-center">
        <Label variant="action" tone="fg">
          {count ? `${count} SELECTED` : 'TAP CONVERSATIONS TO SELECT'}
        </Label>
        <Touchable
          onPress={onToggleAll}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={all ? 'select none' : 'select all'}
        >
          <Label variant="action" tone="stamp">{all ? 'SELECT NONE' : 'SELECT ALL'}</Label>
        </Touchable>
      </View>
      {count ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingVertical: 2 }}
        >
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant="secondary"
              size="compact"
              title={cat.name}
              onPress={busy ? undefined : () => onMove(cat.id)}
            />
          ))}
          <Button
            variant="secondary"
            size="compact"
            title="No category"
            onPress={busy ? undefined : () => onMove(null)}
          />
          <Button
            variant="void"
            size="compact"
            title="Delete"
            onPress={busy ? undefined : onDelete}
          />
        </ScrollView>
      ) : null}
    </ToneProvider>
  );
}
