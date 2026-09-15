/**
 * Ask lyzn — canvas L1, L2, L3.
 *
 * One tab, three states. **L1** is the empty page: what it knows, what it
 * does not, and three questions worth asking. **L2** is a thread — your
 * question as an ink bubble, the answer as paper with the conversations it
 * read cited underneath, and a carbon row while it is thinking. **L3** is
 * the locked card, for an account that has not bought the tier this runs on.
 *
 * The thread lives here rather than on a route of its own. `chat/[id]` is
 * gone: it existed because Mira's home was a list of chats, and Ask lyzn is
 * not a list of chats — it is one question at a time, with what you asked
 * before kept underneath.
 *
 * Two honesty notes, both visible on screen:
 *
 * - the canvas' `ON YOUR MAC · NOTHING SENT ANYWHERE` describes a laptop
 *   daemon that does not exist (`[DAEMON]`). The line says
 *   `ON LYZN · YOUR OWN MEMORY ONLY`, which is what actually happens;
 * - a citation chip is only drawn for a memory hit that names a conversation
 *   this phone can open. A hit that names nothing gets no chip rather than a
 *   chip that goes nowhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, RefreshControl, Alert, Share, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTabBarPadding } from '../../src/design/useTabBarPadding';
import {
  Screen, Txt, Label, Banner, Card, Chip, EmptyCard, Button, AskBar, Touchable,
  Icon, useTone, useToast,
} from '../../src/design/kit';
import { api, type ChatSummary } from '../../src/api/client';
import { searchMemory, type MemoryHit } from '../../src/api/memory';
import { useChat, type Bubble, type PendingAttachment } from '../../src/state/chat';
import { memoryRow } from '../../src/state/memorySteps';
import { useApp } from '../../src/state/store';
import { rememberedLabel } from '@/recordings/remembered';
import { citationChips, type CitationChip } from '../../src/recordings/conversation';
import { dayHeading, dayKey, formatTimeOfDay } from '../../src/recordings/grouping';
import { useFeatures } from '../../src/home/features';
import { ASK_LYZN } from '../../src/design/copy';

/** Client-minted thread id; the backend keys the stored conversation by it. */
function newThreadId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Threads deleted here but possibly not yet deletable server-side. The
 * tombstone hides the thread immediately either way; entries the server has
 * stopped listing are pruned, so the set cannot grow forever.
 */
const TOMBSTONES_KEY = 'pendant.chat.tombstones.v1';

async function loadTombstones(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(TOMBSTONES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveTombstones(ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(TOMBSTONES_KEY, JSON.stringify([...ids])).catch(() => undefined);
}

/** How many pages of `GET /chats` to follow before giving up on the cursor. */
const MAX_PAGES = 20;

/**
 * Every thread, followed to the end of the cursor.
 *
 * A page can come back short or empty with a cursor still set — voice and
 * archived threads are filtered after the page is read (T3b) — so a short
 * page is not the end of the list. Only an absent cursor is.
 */
async function fetchAllChats(): Promise<ChatSummary[]> {
  const all: ChatSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { chats, cursor: next } = await api.getChats(cursor);
    all.push(...chats);
    if (!next) break;
    cursor = next;
  }
  return all;
}

export default function AskLyzn() {
  return (
    <Screen>
      <AskLyznPage />
    </Screen>
  );
}

function AskLyznPage() {
  const router = useRouter();
  const t = useTone();
  const toast = useToast();
  const params = useLocalSearchParams<{ ask?: string }>();
  const bottomPad = useTabBarPadding();
  const features = useFeatures();

  const plan = useApp((s) => s.plan);
  const recordings = useApp((s) => s.recordings);
  const loadRecordings = useApp((s) => s.loadRecordings);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  /** The thread on screen. Undefined is L1. */
  const [threadId, setThreadId] = useState<string>();
  /** Citations per assistant bubble index, from `GET /memory/search`. */
  const [citations, setCitations] = useState<Record<number, CitationChip[]>>({});
  /** Why `GET /chats` did not answer. The recents are a request too. */
  const [chatsError, setChatsError] = useState<string>();

  const conversation = useChat((s) => (threadId ? s.conversations[threadId] : undefined));
  const send = useChat((s) => s.send);
  const load = useChat((s) => s.load);
  const retry = useChat((s) => s.retry);
  const drop = useChat((s) => s.drop);

  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);
  const busy = !!conversation?.busy;

  const refreshChats = useCallback(async () => {
    try {
      const [list, tombstones] = await Promise.all([fetchAllChats(), loadTombstones()]);
      setChats(list.filter((c) => !tombstones.has(c.id)));
      setChatsError(undefined);
      // Server no longer lists it: the delete landed, the tombstone is done.
      const pruned = new Set([...tombstones].filter((id) => list.some((c) => c.id === id)));
      if (pruned.size !== tombstones.size) await saveTombstones(pruned);
    } catch (err) {
      // Keep whatever list is on screen, and say what could not be reached:
      // an account with no threads and an account that would not answer look
      // identical otherwise.
      setChatsError((err as Error)?.message || 'could not be reached');
    }
  }, []);

  // Titles are generated server-side once a thread settles, so coming back
  // to this tab is exactly when a refresh pays off.
  useFocusEffect(useCallback(() => {
    refreshChats();
    if (!recordings.length) loadRecordings();
  }, [refreshChats, recordings.length, loadRecordings]));

  /**
   * What the answer read, as chips that open it.
   *
   * Run once per finished answer, against the question that produced it —
   * `GET /memory/search` is the only read the memory layer offers, and the
   * question is a better query than the answer, which is the model's words
   * rather than yours.
   */
  useEffect(() => {
    const last = messages.length - 1;
    const bubble = messages[last];
    if (!bubble || bubble.role !== 'assistant' || bubble.streaming || bubble.failed) return;
    if (citations[last]) return;
    const question = [...messages].reverse().find((m) => m.role === 'user')?.text;
    if (!question) return;

    let cancelled = false;
    searchMemory(question)
      .then(({ hits }) => {
        if (cancelled) return;
        setCitations((current) => ({ ...current, [last]: citationChips(hits as MemoryHit[], recordings) }));
      })
      // No search, no chips. An answer without citations is still an answer.
      .catch(() => setCitations((current) => ({ ...current, [last]: [] })));
    return () => { cancelled = true; };
  }, [messages, citations, recordings]);

  /**
   * Keep the newest words in view.
   *
   * An answer arrives a token at a time, so the thing worth reading is
   * always the bottom edge. Animated only after the first paint: a jump on
   * arrival reads as a glitch, a scroll while a sentence lands reads as the
   * sentence landing.
   */
  const scroller = useRef<ScrollView>(null);
  const settled = useRef(false);
  const followTail = useCallback(() => {
    scroller.current?.scrollToEnd({ animated: settled.current });
    settled.current = true;
  }, []);
  useEffect(() => { settled.current = false; }, [threadId]);

  /**
   * Staged files, before they are uploaded.
   *
   * They live here and not in the chat store because nothing has been said
   * yet: until the turn is sent these belong to the composer, and abandoning
   * the screen should lose them rather than leave an orphan upload keyed to a
   * thread that was never started.
   */
  const [staged, setStaged] = useState<PendingAttachment[]>([]);

  const ask = (question: string) => {
    const text = question.trim();
    // A file on its own is a question — "what is this?" — so an empty draft
    // with something staged still sends. The store agrees: it only refuses a
    // turn that carries neither.
    if ((!text && !staged.length) || busy) return;
    setDraft('');
    const files = staged;
    setStaged([]);
    const id = threadId ?? newThreadId();
    if (!threadId) { setThreadId(id); setCitations({}); }
    void send(id, text, files);
  };

  const addPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show('Photos are not shared with this app', { tone: 'error' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // The answer reads a picture, it does not print it: full resolution
      // costs upload time on a phone network and buys nothing.
      quality: 0.8,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    if (!picked) return;
    setStaged((current) => [...current, {
      uri: picked.uri,
      name: picked.fileName ?? `photo-${Date.now()}.jpg`,
      mime: picked.mimeType ?? 'image/jpeg',
      sizeBytes: picked.fileSize ?? 0,
    }]);
  };

  const addFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      // Without this the uri can be a provider handle that stops resolving the
      // moment the picker closes, and the upload reads nothing.
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    if (!picked) return;
    setStaged((current) => [...current, {
      uri: picked.uri,
      name: picked.name,
      mime: picked.mimeType ?? 'application/octet-stream',
      sizeBytes: picked.size ?? 0,
    }]);
  };

  const attach = () => {
    Alert.alert(ASK_LYZN.attachTitle, undefined, [
      { text: ASK_LYZN.attachPhoto, onPress: () => { void addPhoto(); } },
      { text: ASK_LYZN.attachFile, onPress: () => { void addFile(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /**
   * `lyzn:///(tabs)/lyzn?ask=…` sends a question on arrival.
   *
   * Development only, and it exists because a simulator has no way to type:
   * `simctl` can open a URL and take a picture, but it cannot tap a text
   * field, so without this the one screen that needs words typed into it is
   * the one screen that cannot be tested from a script. Asked once per
   * distinct question, so a re-render does not send it again.
   */
  const asked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!__DEV__) return;
    const question = typeof params.ask === 'string' ? params.ask.trim() : '';
    if (!question || asked.current === question || busy) return;
    asked.current = question;
    ask(question);
  });

  const openThread = (chat: ChatSummary) => {
    setThreadId(chat.id);
    setCitations({});
    void load(chat.id);
  };

  const removeThread = (chat: ChatSummary) => {
    Alert.alert(`Delete “${chat.title || 'this thread'}”?`, ASK_LYZN.deleteBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setChats((c) => c.filter((x) => x.id !== chat.id));
          if (threadId === chat.id) { setThreadId(undefined); drop(chat.id); }
          const tombstones = await loadTombstones();
          tombstones.add(chat.id);
          await saveTombstones(tombstones);
          // Best effort; the tombstone already hides it either way.
          api.deleteChat(chat.id).catch(() => undefined);
        },
      },
    ]);
  };

  // -- L3: the tier gate ---------------------------------------------------

  /**
   * Locked only when the account has no automation **and** the flag is off.
   * The default configuration has `askLyzn: true`, so this is a screen that
   * exists rather than one anybody sees today (plan §2.4).
   */
  const locked = !features.askLyzn && !plan?.automation;

  const threadCount = chats.length + (chats.some((c) => c.id === threadId) ? 0 : 1);
  const eyebrow = threadId
    ? `${threadCount} ${threadCount === 1 ? 'THREAD' : 'THREADS'}`
    : locked
      ? 'NEEDS THE ACT TIER'
      : rememberedLabel(recordings);

  return (
    // The ask bar rides above the keyboard: this is a screen whose whole
    // purpose is typing into the thing at the bottom of it.
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {chatsError ? (
        <Banner
          variant="void"
          label={[ASK_LYZN.couldNotLoad, chatsError]}
          action={ASK_LYZN.retry}
          onAction={() => void refreshChats()}
        />
      ) : null}
      <View className="flex-row justify-between items-start px-[22px] pt-[10px] pb-[12px]">
        <View>
          <Txt variant="screen">{ASK_LYZN.title}</Txt>
          {/* While a thread is open the count is the way out of it: the
              recents are hidden below, so this is the only path back. */}
          <Touchable
            onPress={threadId ? () => setThreadId(undefined) : undefined}
            disabled={!threadId}
            scaleTo={1}
            haptic="none"
            hitSlop={10}
            accessibilityRole={threadId ? 'button' : undefined}
            accessibilityLabel={threadId ? ASK_LYZN.backToThreads : undefined}
          >
            <Label variant="back" tone={threadId ? 'stamp' : 'faint'} className="mt-[4px]">
              {threadId ? `← ${eyebrow}` : eyebrow}
            </Label>
          </Touchable>
        </View>
        {threadId ? (
          <Touchable
            onPress={() => { setThreadId(undefined); setCitations({}); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="new question"
          >
            <Label variant="back" tone="stamp">NEW</Label>
          </Touchable>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: 18,
          gap: 12,
          // A thread is read from the bottom: a two-line exchange belongs
          // above the ask bar, not stranded at the top of an empty screen.
          // The list and the locked card keep their own top alignment.
          ...(threadId && !locked ? { flexGrow: 1, justifyContent: 'flex-end' as const } : null),
        }}
        onContentSizeChange={followTail}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await refreshChats(); setRefreshing(false); }}
            tintColor={t.faint}
          />
        }
      >
        {locked ? (
          <Locked onPlans={() => router.push('/onboarding/plan')} onBrowse={() => router.push('/(tabs)')} />
        ) : threadId ? (
          <Thread
            messages={messages}
            busy={busy}
            citations={citations}
            onRetry={() => retry(threadId)}
            onOpen={(recordingId) => router.push(`/recording/${recordingId}`)}
            onShare={(text) => { void Share.share({ message: text }); }}
          />
        ) : (
          <Empty onAsk={ask} />
        )}

        {!locked && !threadId && chats.length ? (
          <Recents
            chats={chats}
            activeId={threadId}
            onOpen={openThread}
            onRemove={removeThread}
          />
        ) : null}
      </ScrollView>

      {locked ? null : (
        <View className="px-[18px] gap-[8px]" style={{ paddingBottom: bottomPad }}>
          {staged.length ? (
            <View className="flex-row flex-wrap gap-[6px]">
              {staged.map((file, i) => (
                <AttachedFile
                  key={`${file.uri}-${i}`}
                  name={file.name}
                  onRemove={() =>
                    setStaged((current) => current.filter((_, n) => n !== i))}
                />
              ))}
            </View>
          ) : null}
          <AskBar
            glass
            value={draft}
            onChangeText={setDraft}
            onSubmit={() => ask(draft)}
            placeholder={ASK_LYZN.placeholder}
            action={ASK_LYZN.action}
            busy={busy}
            icon={Icon.Paperclip}
            onAttach={attach}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// -- the three states ------------------------------------------------------

/** L1: what it knows, what it does not, and three ways to start. */
function Empty({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <View className="gap-[9px]">
      <EmptyCard {...ASK_LYZN.empty} />
      <Label variant="eyebrow" className="mt-[7px]">{ASK_LYZN.tryThese}</Label>
      {ASK_LYZN.suggestions.map((suggestion) => (
        <Card key={suggestion} onPress={() => onAsk(suggestion)} accessibilityLabel={suggestion}>
          <Txt variant="bodyL">{suggestion}</Txt>
        </Card>
      ))}
    </View>
  );
}

/** L2: the thread, and the ground it stands on. */
/**
 * A file on a sent question.
 *
 * The name, not a thumbnail: an attachment here is evidence the answer was
 * given something to look at, and the thing worth showing is which file that
 * was. A preview would need a fetch per bubble and a layout that survives a
 * portrait photo next to a PDF.
 */
function AttachedFile({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <View className="flex-row items-center gap-[7px] bg-tone-panel border-[1.5px] border-tone-line2 py-[7px] px-[10px] rounded-[12px]">
      <Label variant="tag" tone="muted" numberOfLines={1} className="max-w-[150px]">
        {name}
      </Label>
      {onRemove ? (
        <Touchable
          onPress={onRemove}
          hitSlop={10}
          scaleTo={1}
          haptic="none"
          accessibilityRole="button"
          accessibilityLabel={`remove ${name}`}
        >
          <Label variant="tag" tone="faint">✕</Label>
        </Touchable>
      ) : null}
    </View>
  );
}

function Thread({ messages, busy, citations, onRetry, onOpen, onShare }: {
  messages: Bubble[];
  busy: boolean;
  citations: Record<number, CitationChip[]>;
  onRetry: () => void;
  onOpen: (recordingId: string) => void;
  onShare: (text: string) => void;
}) {
  const last = messages[messages.length - 1];
  /** How many conversations the running turn says it read, from its tool events. */
  const reading = last?.steps?.find((s) => s.name === 'memory.recall')?.hits;

  return (
    <View className="gap-[12px]">
      {messages.map((bubble, i) => (
        bubble.role === 'user' ? (
          // The question is the quoted thing: a bubble, held to the right, and
          // never the full width — it is what *you* said, and it has to read as
          // an aside next to the answer rather than as part of it.
          <View key={i} className="self-end items-end gap-[6px] max-w-[82%]">
            {bubble.attachments?.length ? (
              <View className="flex-row flex-wrap justify-end gap-[6px]">
                {bubble.attachments.map((file, n) => (
                  <AttachedFile key={`${file.name}-${n}`} name={file.name} />
                ))}
              </View>
            ) : null}
            {bubble.text ? (
              <View className="bg-tone-inv-bg rounded-[18px] py-[11px] px-[15px]">
                <Txt variant="bodyL" tone="inv">{bubble.text}</Txt>
              </View>
            ) : null}
          </View>
        ) : bubble.text ? (
          // The answer takes the page. No card, no ground of its own, no
          // width cap: it is the document being read, and a bubble around it
          // would make the longest thing on screen the most boxed-in.
          <View key={i} className="gap-[9px]">
            <Touchable
              onPress={bubble.failed ? onRetry : undefined}
              // An answer is worth keeping: hold it to send it on. Sharing
              // text needs nothing native, which is why it is the one action
              // offered rather than a copy that would need a module.
              onLongPress={bubble.failed ? undefined : () => onShare(bubble.text)}
              disabled={!bubble.failed && !bubble.text}
              scaleTo={1}
              haptic="none"
              accessibilityLabel={bubble.text}
              accessibilityHint={bubble.failed ? undefined : ASK_LYZN.shareHint}
            >
              <Txt variant="body" tone={bubble.failed ? 'danger' : 'fg'}>
                {bubble.text}
                {bubble.streaming ? <Txt variant="body" tone="stamp">{' ▍'}</Txt> : null}
              </Txt>
            </Touchable>
            {/* What the turn *did*, as opposed to what it looked up. A
                filed task outlives the thinking line — it is the record that
                something was handed to a machine — so it is drawn on the
                answer rather than in the spinner above. */}
            {bubble.steps?.some((s) => s.name === 'task.sent') ? (
              <Label variant="tag" tone="stamp">
                {memoryRow(
                  bubble.steps.filter((s) => s.name === 'task.sent').slice(-1)[0],
                ).label}
              </Label>
            ) : null}
            {citations[i]?.length ? (
              <View className="flex-row flex-wrap gap-[6px]">
                {citations[i].map((chip) => (
                  <Chip
                    key={chip.key}
                    label={chip.label}
                    tone="stamp"
                    onPress={() => onOpen(chip.recordingId)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null
      ))}

      {busy ? (
        <Card variant="carbon" pad="tight" className="flex-row items-center gap-[11px]">
          <View className="flex-row items-end gap-[3px] h-[14px]">
            <View className="w-[3px] h-[6px] bg-tone-stamp" />
            <View className="w-[3px] h-[13px] bg-tone-stamp" />
            <View className="w-[3px] h-[9px] bg-tone-stamp" />
          </View>
          <Label variant="tag" tone="stamp" className="flex-1">
            {[ASK_LYZN.thinking, reading
              ? `READING ${reading} ${reading === 1 ? 'CONVERSATION' : 'CONVERSATIONS'}`
              : undefined]}
          </Label>
        </Card>
      ) : null}

      <Label variant="eyebrow">{ASK_LYZN.ground}</Label>
    </View>
  );
}

/**
 * L3: locked, and still saying what it would have said — except that it
 * cannot, because nothing was asked. The canvas draws a sample answer behind
 * a scrim; a sample answer is a made-up one, so the card says what the tier
 * buys and offers the way to it.
 */
function Locked({ onPlans, onBrowse }: { onPlans: () => void; onBrowse: () => void }) {
  return (
    <View className="gap-[11px]">
      <Card variant="carbon" pad="roomy" className="gap-[9px]">
        <Label variant="eyebrow">{ASK_LYZN.locked.eyebrow}</Label>
        <Txt variant="statement">{ASK_LYZN.locked.statement}</Txt>
        <Txt variant="bodyL" tone="muted">{ASK_LYZN.locked.line}</Txt>
      </Card>
      <Button full title={ASK_LYZN.locked.action} onPress={onPlans} />
      <Button full variant="ghost" title={ASK_LYZN.locked.browse} onPress={onBrowse} />
    </View>
  );
}

// -- what you asked before -------------------------------------------------

/** The recents, grouped by day the way conversations are. */
function Recents({ chats, activeId, onOpen, onRemove }: {
  chats: ChatSummary[];
  activeId?: string;
  onOpen: (chat: ChatSummary) => void;
  onRemove: (chat: ChatSummary) => void;
}) {
  const groups = useMemo(() => {
    const out: { key: string; heading: string; items: ChatSummary[] }[] = [];
    for (const chat of chats) {
      const valid = !Number.isNaN(new Date(chat.updatedAt).getTime());
      const key = valid ? dayKey(chat.updatedAt) : 'unknown';
      const group = out[out.length - 1];
      if (group?.key === key) group.items.push(chat);
      else out.push({ key, heading: valid ? dayHeading(chat.updatedAt) : '', items: [chat] });
    }
    return out;
  }, [chats]);

  return (
    <View className="gap-[9px] mt-[11px]">
      <Label variant="eyebrow">{ASK_LYZN.recent}</Label>
      {groups.map((group) => (
        <View key={group.key} className="gap-[7px]">
          {group.heading ? (
            <Label variant="chip" className="mt-[4px]">{group.heading.toUpperCase()}</Label>
          ) : null}
          {group.items.map((chat) => (
            <Touchable
              key={chat.id}
              onPress={() => onOpen(chat)}
              onLongPress={() => onRemove(chat)}
              scaleTo={1}
              accessibilityRole="button"
              accessibilityLabel={chat.title || 'New thread'}
              className="flex-row items-center gap-[11px] py-[11px]"
            >
              <Txt
                variant="bodyL"
                tone={chat.id === activeId ? 'stamp' : chat.title ? 'fg' : 'muted'}
                numberOfLines={1}
                className="flex-1"
              >
                {chat.title || 'New thread'}
              </Txt>
              <Label variant="chip">{formatTimeOfDay(chat.updatedAt)}</Label>
            </Touchable>
          ))}
        </View>
      ))}
    </View>
  );
}
