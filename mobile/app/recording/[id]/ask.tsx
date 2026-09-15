/**
 * Ask lyzn, about this conversation — canvas C4.
 *
 * A sheet over the detail, scoped to one conversation, whose answers cite
 * the moments they came from and whose chips take you there.
 *
 * `POST /chat` has **no per-recording scope**, so the scope is built in the
 * first message. How, and why that is honest, is written down in
 * `src/recordings/ask.ts`, which is where the preamble lives and where it is
 * tested. This file is the sheet around it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Sheet, Txt, Label, Chip, AskBar, Icon, MarkPulse,
} from '../../../src/design/kit';
import { api, type Recording, type Transcript } from '../../../src/api/client';
import { useChat } from '../../../src/state/chat';
import { requestSeek } from '../../../src/recordings/seek';
import { askPreamble, askQuestionOf, askThreadId } from '../../../src/recordings/ask';
import { answerCitations, clockSpan, wallClock } from '../../../src/recordings/conversation';
import { formatSpan } from '../../../src/recordings/grouping';
import { ASK_SHEET } from '../../../src/design/copy';

export default function AskAboutConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const threadId = askThreadId(id);

  const [recording, setRecording] = useState<Recording>();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [draft, setDraft] = useState('');

  const conversation = useChat((s) => s.conversations[threadId]);
  const send = useChat((s) => s.send);

  useEffect(() => {
    let cancelled = false;
    api.getRecording(id)
      .then((detail) => {
        if (cancelled) return;
        setRecording(detail.recording);
        setTranscript(detail.transcript);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [id]);

  const messages = conversation?.messages ?? [];
  const busy = !!conversation?.busy;

  /** The conversation, in the words the preamble sends it as. */
  const scope = useMemo(() => {
    if (!recording) return undefined;
    const speaker = (index: number) =>
      recording.speakers?.[String(index)]
      ?? recording.speakerProfiles?.[String(index)]?.label
      ?? `Speaker ${index + 1}`;
    const voices = new Set([
      ...Object.keys(recording.speakers ?? {}),
      ...Object.keys(recording.speakerProfiles ?? {}),
    ]);
    return {
      title: recording.title,
      when: clockSpan(recording.startedAt, recording.durationSeconds),
      speakers: [...voices].map((key) => {
        const description = recording.speakerProfiles?.[key]?.description;
        const name = speaker(Number(key));
        return description ? `${name} — ${description}` : name;
      }),
      summary: recording.summary,
      commitments: (recording.actionItems ?? []).map((a) => a.text),
      lines: (transcript?.utterances ?? []).map((u) =>
        `${wallClock(recording.startedAt, u.start)} ${speaker(u.speaker)}: ${u.text}`),
    };
  }, [recording, transcript]);

  const ask = useCallback((question: string) => {
    const text = question.trim();
    if (!text || !scope || busy) return;
    setDraft('');
    // Only the opening turn carries the conversation: after that the stored
    // window has it, and re-sending a transcript every turn would be paid
    // for on every turn.
    const first = messages.length === 0;
    void send(threadId, first ? askPreamble(scope, text) : text);
  }, [scope, messages.length, busy, send, threadId]);

  const close = () => router.back();

  const context = useMemo(() => {
    if (!recording) return ASK_SHEET.scope;
    const commitments = recording.actionItems?.length ?? 0;
    return [
      ASK_SHEET.scope,
      recording.durationSeconds > 0 ? formatSpan(recording.durationSeconds).toLowerCase() : undefined,
      commitments ? `${commitments} ${commitments === 1 ? 'commitment' : 'commitments'}` : undefined,
    ].filter(Boolean).join(' · ');
  }, [recording]);

  /**
   * A turn, as it is shown: the user's question without the preamble it was
   * sent with. The preamble is how the question was asked, not what was
   * asked, and showing it back would bury the thread in its own transcript.
   */
  const shown = useMemo(
    () => messages.map((bubble) => (
      bubble.role === 'user' ? { ...bubble, text: askQuestionOf(bubble.text) } : bubble
    )),
    [messages],
  );

  return (
    <>
      <Stack.Screen options={{ presentation: 'transparentModal', animation: 'none' }} />
      <Sheet
        visible
        onClose={close}
        title={ASK_SHEET.title}
        icon={Icon.MessageSquare}
        context={context}
        closeLabel={ASK_SHEET.close}
      >
        <ScrollView
          className="max-h-[420px]"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, gap: 13 }}
          keyboardShouldPersistTaps="handled"
        >
          {!recording ? (
            <View className="py-[24px] items-center"><MarkPulse /></View>
          ) : null}

          {shown.map((bubble, i) => (
            bubble.role === 'user' ? (
              <View key={i} className="self-start max-w-[78%] bg-tone-inv-bg py-[11px] px-[13px]">
                <Txt variant="bodyL" tone="inv">{bubble.text}</Txt>
              </View>
            ) : (
              <View key={i} className="max-w-[92%] gap-[7px]">
                {bubble.text ? (
                  <Txt variant="bodyL" tone={bubble.failed ? 'danger' : 'fg'}>{bubble.text}</Txt>
                ) : (
                  <Label variant="tag" tone="stamp">THINKING…</Label>
                )}
                {!bubble.streaming && recording && bubble.text ? (
                  <Citations
                    text={bubble.text}
                    startedAt={recording.startedAt}
                    utterances={transcript?.utterances ?? []}
                    onSeek={(seconds) => { requestSeek(id, seconds); close(); }}
                  />
                ) : null}
              </View>
            )
          ))}

          {recording && !messages.length ? (
            <View className="flex-row flex-wrap gap-[7px]">
              {ASK_SHEET.suggestions.map((suggestion) => (
                <Chip key={suggestion} label={suggestion} onPress={() => ask(suggestion)} />
              ))}
            </View>
          ) : null}
        </ScrollView>

        <AskBar
          className="mx-[20px] mt-[16px] mb-[12px]"
          value={draft}
          onChangeText={setDraft}
          onSubmit={() => ask(draft)}
          placeholder={ASK_SHEET.placeholder}
          busy={busy}
          action="ASK"
        />
      </Sheet>
    </>
  );
}

/**
 * The `↳ 11:08` chips under an answer.
 *
 * They are the times the answer names, resolved against this transcript —
 * so a chip exists only where the reader can actually be taken somewhere
 * (`answerCitations`). No times, no chips, and nothing that says there were
 * none: a row of nothing is not information.
 */
function Citations({ text, startedAt, utterances, onSeek }: {
  text: string;
  startedAt: string;
  utterances: { start: number; end: number }[];
  onSeek: (seconds: number) => void;
}) {
  const chips = useMemo(
    () => answerCitations(text, startedAt, utterances),
    [text, startedAt, utterances],
  );
  if (!chips.length) return null;
  return (
    <View className="flex-row flex-wrap gap-[6px]">
      {chips.map((chip) => (
        <Chip key={chip.label} label={chip.label} tone="stamp" onPress={() => onSeek(chip.seconds)} />
      ))}
    </View>
  );
}
