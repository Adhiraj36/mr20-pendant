/**
 * The kit, on one page — every component in every variant and state.
 *
 * A development route (`lyzn:///_kit`), not a screen: it exists so that a
 * change to the kit can be looked at in both themes in one scroll, and so
 * that the screenshots in a task report are of the real components on a real
 * device rather than of a drawing. It renders `null` in a production build,
 * so the bundle keeps the file and the app never has the route.
 */
import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  Screen, TopRow, TopAction, Txt, Label, MetaLine, Card, Button, Segments,
  Toggle, Field, CodeBoxes, Chip, Banner, EmptyCard, Progress, AskBar,
  KeyValue, KeyValues, SettingsRow, TaskCard, ConversationRow,
  NotificationCard, RecordingPill, Receipt, ReceiptCard, Sheet, TabBar, TABS,
  Waveform, InkPicker, useInk, Icon, TickRow, Scrub, Enter, MarkPulse,
  useTheme, setTheme, conversationChips, taskCardState, receiptFromTask,
  type TaskLike,
} from '../src/design/kit';

/** A titled block, so the screenshots can be read against the canvas. */
function Section({ title, note, children }: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-[10px] mt-[28px]">
      <Label variant="eyebrow" tone="muted">{title}</Label>
      {note ? <Label variant="chip">{note}</Label> : null}
      <View className="gap-[9px]">{children}</View>
    </View>
  );
}

const SAMPLE_TASK: TaskLike = {
  taskId: 't-0412',
  text: 'Send the revised quote to Ravi K.',
  kind: 'message',
  status: 'done',
  owner: 'Ravi K.',
  quote: "I'll send you the revised quote before lunch.",
  doneAt: '2026-09-08T11:05:07.000Z',
};

export default function KitGallery() {
  // Production builds get the file and no route: the gallery is a tool, and
  // a tool that ships is a screen nobody meant to write.
  if (!__DEV__) return null;
  return <Gallery />;
}

function Gallery() {
  const theme = useTheme();
  const [segment, setSegment] = useState('conversations');
  const [tab, setTab] = useState('home');
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [text, setText] = useState('');
  const [bad, setBad] = useState('98490 44');
  const [code, setCode] = useState('419');
  const [ask, setAsk] = useState('');
  const [scrub, setScrub] = useState(0.38);
  const [sheet, setSheet] = useState(false);
  const [ink, setInk] = useInk();
  const [selected, setSelected] = useState(false);

  const receipt = receiptFromTask(SAMPLE_TASK);

  return (
    <Screen edges={['top']}>
      <TopRow
        back="TODAY"
        onBack={() => undefined}
        right={<TopAction label={theme.ground.toUpperCase()} />}
      />

      <ScrollView
        contentContainerClassName="px-[18px] pb-[40px]"
        showsVerticalScrollIndicator={false}
      >
        <Txt variant="screen">The kit</Txt>
        <MetaLine parts={['EVERY PART ON THE CANVAS', theme.ground.toUpperCase()]} />

        {/* The appearance switch, and the `Segments` control demonstrating
            itself: everything below is drawn from the same `--tone-*`
            variables, so this is the only control on the page that changes
            what any of the others look like. */}
        <Segments
          className="mt-[12px]"
          value={theme.theme}
          onChange={setTheme}
          options={[
            { value: 'light' as const, label: 'LIGHT' },
            { value: 'dark' as const, label: 'DARK' },
            { value: 'system' as const, label: 'SYSTEM' },
          ]}
        />

        <Section title="TXT" note="THE SANS LADDER">
          <Card pad="roomy" className="gap-[8px]">
            <Txt variant="screen">Today</Txt>
            <Txt variant="title">Quote review with Ravi</Txt>
            <Txt variant="statement">Put the pendant on and talk to somebody.</Txt>
            <Txt variant="card">Order Amma&rsquo;s birthday cake</Txt>
            <Txt variant="row">Standup — design team</Txt>
            <Txt variant="strong">Sends a message</Txt>
            <Txt variant="body">Body copy, fifteen on a one-and-a-half leading.</Txt>
            <Txt variant="small" tone="muted">A card&rsquo;s supporting line.</Txt>
            <Txt variant="quote" tone="muted">&ldquo;Amma birthday ki cake book cheyyali.&rdquo;</Txt>
          </Card>
        </Section>

        <Section title="LABEL · METALINE" note="MONO, UPPERCASE, JOINED WITH ·">
          <Card className="gap-[6px]">
            <Label variant="button" tone="fg">APPROVE &amp; SEND</Label>
            <Label variant="back" tone="fg">← TODAY</Label>
            <Label variant="action" tone="stamp">REVIEW</Label>
            <Label variant="nav">CONVERSATIONS</Label>
            <Label variant="eyebrow">WHAT WILL HAPPEN</Label>
            <Label variant="tag">SENDS A MESSAGE · RAVI K.</Label>
            <Label variant="chip">TE + EN</Label>
            <Label variant="loud" tone="fg">YOU STILL HAVE TO DO THIS</Label>
            <MetaLine parts={['11:04', 'OFFICE', undefined, '22 MIN']} />
            <MetaLine parts={['TUE 04 SEP', false, 'NOTHING YET']} />
          </Card>
        </Section>

        <Section title="CARD" note="PAPER · CARBON · VOID · STAMP · DASHED · INK">
          <Card><Txt variant="strong">paper — settled or historical</Txt></Card>
          <Card variant="carbon"><Txt variant="strong">carbon — waiting on you</Txt></Card>
          <Card variant="void"><Txt variant="strong" tone="danger">void — a rule, never a fill</Txt></Card>
          <Card variant="stamp"><Txt variant="strong">stamp — the live action</Txt></Card>
          <Card variant="dashed"><Txt variant="small" tone="muted">dashed — nothing here yet</Txt></Card>
          <Card variant="ink"><Txt variant="strong" tone="inv">ink — a different layer</Txt></Card>
        </Section>

        <Section title="BUTTON" note="PRIMARY · SECONDARY · VOID · STAMP · GHOST · DISABLED">
          <Button title="APPROVE &amp; SEND" onPress={() => undefined} full />
          <Button variant="secondary" title="EDIT" onPress={() => undefined} full />
          <Button variant="void" title="PAUSE LISTENING" onPress={() => undefined} full />
          <Button variant="stamp" title="START TALKING" onPress={() => undefined} full />
          <Button variant="ghost" title="I ALREADY HAVE AN ACCOUNT" onPress={() => undefined} full />
          <Button title="DISABLED" disabled full />
          <Button title="SENDING" busy busyLabel="SENDING…" onPress={() => undefined} full />
          <View className="flex-row gap-[8px]">
            <Button size="compact" title="APPROVE" onPress={() => undefined} className="flex-1" />
            <Button size="compact" variant="secondary" title="EDIT" onPress={() => undefined} className="flex-1" />
          </View>
          <Button size="compact" variant="secondary" title="SHARE" icon={Icon.Share2} onPress={() => undefined} />
        </Section>

        <Section title="SEGMENTS" note="ONE INK BOX, THE ACTIVE PART FILLED">
          <Segments
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'conversations', label: 'CONVERSATIONS' },
              { value: 'tasks', label: 'TASKS · 3' },
              { value: 'receipts', label: 'RECEIPTS' },
            ]}
          />
        </Section>

        <Section title="TOGGLE" note="44 × 26 — THE ONE PILL">
          <SettingsRow label="Sends a message" note="ASK ME FIRST" right={<Toggle value={on} onChange={setOn} label="sends a message" />} />
          <SettingsRow label="Reminders and notes" note="RUNS AUTOMATICALLY" noteTone="faint" right={<Toggle value={off} onChange={setOff} label="reminders and notes" />} />
          <SettingsRow label="Locked" right={<Toggle value disabled label="locked" />} />
        </Section>

        <Section title="FIELD" note="1.5 INK · FOCUS 2 STAMP · INVALID VOID">
          <Field value={text} onChangeText={setText} placeholder="Ask about your day…" />
          <Field value={bad} onChangeText={setBad} invalid message="THAT NUMBER IS ONE DIGIT SHORT" />
          <Field value="" onChangeText={() => undefined} placeholder="Longer note…" multiline />
        </Section>

        <Section title="CODEBOXES" note="SIX BOXES 62 TALL · CARET IN STAMP">
          <CodeBoxes value={code} onChangeText={setCode} autoFocus={false} />
        </Section>

        <Section title="KEYVALUE" note="DOTTED LEADER, THREE POINTS UNDER THE BASELINE">
          <Card>
            <KeyValues
              rows={[
                { k: 'SENDS ON', v: 'WHATSAPP' },
                { k: 'TO', v: 'RAVI K. · ••••• 8802' },
                { k: 'ATTACHES', v: 'quote-RK-0904.pdf' },
                { k: 'DELIVERED', v: '11:05:07', ok: true },
                { k: 'GATED BECAUSE', v: 'IT WRITES AS YOU', tone: 'danger' },
              ]}
            />
          </Card>
        </Section>

        <Section title="TASKCARD" note="WAITING · RUNNING · DONE · FAILED · CAPTURE">
          <TaskCard
            state="waiting"
            eyebrow="SPENDS ₹540 · KARACHI BAKERY"
            title="Order Amma&rsquo;s birthday cake"
            quote="Amma birthday ki cake book cheyyali."
            primaryAction={{ label: 'APPROVE', onPress: () => undefined }}
            secondaryAction={{ label: 'EDIT', onPress: () => undefined }}
          />
          <TaskCard
            state="waiting"
            selected={selected}
            onToggleSelect={() => setSelected((s) => !s)}
            eyebrow="SENDS A MESSAGE · WHATSAPP TO RAVI K."
            title="Send the revised quote, 3 mm rate"
            quote="I'll send you the revised quote before lunch."
          />
          <TaskCard
            state="running"
            meta="APPROVED 11:05:01"
            title="Send the revised quote to Ravi K."
            progress={0.64}
            progressNote="ATTACHING quote-RK-0904.pdf"
          />
          <TaskCard
            state="done"
            meta="DELIVERED 11:05:07"
            title="Send the revised quote to Ravi K."
            receiptRef="RECEIPT #0412"
            onOpenReceipt={() => undefined}
          />
          <TaskCard
            state="failed"
            meta="TRIED 12:02 · STOPPED"
            title="Order Amma&rsquo;s birthday cake"
            reason="The bakery&rsquo;s payment page wanted an OTP that expired before I could use it."
            primaryAction={{ label: 'TRY AGAIN', onPress: () => undefined }}
            secondaryAction={{ label: 'WHAT HAPPENED', onPress: () => undefined }}
          />
          <TaskCard
            state="capture"
            eyebrow="WOULD SEND A MESSAGE · RAVI K."
            title="Send the revised quote, 3 mm rate"
            quote="I'll send you the revised quote before lunch."
            primaryAction={{ label: 'MARK DONE', onPress: () => undefined }}
          />
          <Label variant="chip">
            {`taskCardState('proposed', { execution: false }) → ${taskCardState('proposed', { execution: false })}`}
          </Label>
        </Section>

        <Section title="CONVERSATIONROW">
          <ConversationRow
            when="11:04"
            place="OFFICE"
            duration="22 MIN"
            title="Quote review with Ravi"
            summary="Pricing on the revised thickness spec, delivery timeline, and the sample batch."
            chips={conversationChips({ languages: ['te', 'en'], commitments: 2 })}
            onPress={() => undefined}
          />
          <ConversationRow
            when="09:41"
            place="CALL"
            duration="8 MIN"
            title="Standup — design team"
            summary="STEP file handoff, LED placement decision, vendor follow-up owner."
            chips={conversationChips({ languages: ['en'], done: 1 })}
          />
        </Section>

        <Section title="RECEIPT" note="PAPER ALWAYS · STAMP AT −11°">
          {receipt ? (
            <Receipt
              stamp={receipt.stamp}
              quote={receipt.quote}
              rows={receipt.rows}
              footer="IF THERE'S NO RECEIPT, IT DIDN'T HAPPEN"
              barcodeSeed={receipt.taskId}
            />
          ) : null}
        </Section>

        <Section title="RECEIPTCARD" note="THE ROLL ITEM">
          <ReceiptCard
            stamp="DONE"
            quote="I'll send you the revised quote before lunch."
            rows={[{ k: 'TO', v: 'RAVI K.' }, { k: 'DELIVERED', v: '11:05:07', ok: true }]}
            onPress={() => undefined}
          />
          <ReceiptCard
            quote="Send the STEP file today."
            rows={[{ k: 'SENT ON', v: 'WECHAT' }, { k: 'READ', v: '13:31', ok: true }]}
          />
        </Section>

        <Section title="BANNER" note="CARBON · VOID · PAPER">
          <Banner label="YOUR MACBOOK IS ASLEEP · 3 JOBS HELD" action="FIX" onAction={() => undefined} />
          <Banner variant="void" label="PENDANT STORAGE FULL · RECORDING STOPPED" />
          <Banner variant="paper" label="ALL SYNCED · 09:38" action="DETAILS" onAction={() => undefined} />
        </Section>

        <Section title="EMPTYCARD">
          <EmptyCard
            eyebrow="CONVERSATIONS · EMPTY"
            statement="Put the pendant on and talk to somebody."
            line="Your first conversation shows up here about a minute after it ends."
            action="START RECORDING"
            onAction={() => undefined}
          />
          <EmptyCard
            eyebrow="RECEIPTS · EMPTY"
            statement="Nothing has been finished yet, so there&rsquo;s nothing to print."
            line="Approve one task and the first receipt prints itself."
          />
        </Section>

        <Section title="NOTIFICATIONCARD" note="ASK · DONE · NOTE">
          <NotificationCard
            variant="ask"
            source="LYZN · NEEDS YOUR YES"
            when="NOW"
            title="Send Ravi the revised quote?"
            body="You said before lunch. Draft&rsquo;s ready with the PDF attached."
            primaryAction={{ label: 'SEND IT', onPress: () => undefined }}
            secondaryAction={{ label: 'READ IT FIRST', onPress: () => undefined }}
          />
          <NotificationCard
            variant="done"
            source="LYZN · DONE"
            when="11:05"
            title="Quote delivered to Ravi K."
            footnote="11:05:07 ✓ · RECEIPT #0412"
          />
          <NotificationCard source="LYZN" when="11:04" title="Recording started · Office" />
        </Section>

        <Section title="RECORDINGPILL">
          <RecordingPill detail="Now · 04:12" />
          <RecordingPill label="STILL RECORDING" detail="Now · 12:08 · nothing is lost" />
        </Section>

        <Section title="PROGRESS · TICKROW · SCRUB · WAVEFORM">
          <Card className="gap-[12px]">
            <Progress value={0.64} />
            <Progress value={0.36} tone="ink" size={6} />
            <Progress value={1} tone="danger" size={6} />
            <Progress value={0.8} tone="settled" />
            <TickRow ticks={16} value={0.42} height={14} />
            <Scrub value={scrub} onSeek={setScrub} />
            <View className="flex-row items-end gap-[16px]">
              <Waveform active bars={12} height={40} />
              <Waveform active bars={6} height={24} tone="stamp" />
              <Waveform active={false} bars={6} height={24} tone="muted" />
            </View>
          </Card>
        </Section>

        <Section title="CHIP">
          <View className="flex-row flex-wrap gap-[7px]">
            <Chip label="TE + EN" />
            <Chip label="2 COMMITMENTS" tone="stamp" />
            <Chip label="1 DONE ✓" tone="settled" />
            <Chip label="FAILED" tone="danger" />
            <Chip label="↳ 11:08" tone="stamp" onPress={() => undefined} />
          </View>
        </Section>

        <Section title="ASKBAR">
          <AskBar value={ask} onChangeText={setAsk} onSubmit={() => setAsk('')} icon={Icon.Paperclip} />
          <AskBar value="" onChangeText={() => undefined} placeholder="Ask about this conversation…" />
        </Section>

        <Section title="INKPICKER" note="SELECTED = DOUBLE RING IN ITS OWN INK">
          <InkPicker value={ink} onChange={setInk} />
          <Label variant="chip">{`lyzn.ink → ${ink}`}</Label>
        </Section>

        <Section title="SETTINGSROW">
          <SettingsRow label="Account" value="NIKHIL · ••••• 4417" onPress={() => undefined} />
          <SettingsRow label="Keep audio" value="30 DAYS" onPress={() => undefined} />
          <SettingsRow label="Delete everything" value="CAN'T BE UNDONE" danger onPress={() => undefined} />
        </Section>

        <Section title="SHEET">
          <Button variant="secondary" title="OPEN THE SHEET" onPress={() => setSheet(true)} full />
        </Section>

        <Section title="ENTER · MARKPULSE">
          <Enter index={0}>
            <Card className="items-center py-[24px]"><MarkPulse size={32} /></Card>
          </Enter>
        </Section>

        <Section title="TABBAR" note="HOME · LYZN · PENDANT">
          <TabBar items={TABS} value={tab} onChange={setTab} />
        </Section>
      </ScrollView>

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="ASK LYZN"
        context={['This conversation only', '22 min', '2 commitments']}
      >
        <View className="px-[20px] pt-[16px] gap-[13px]">
          <Card variant="ink" className="self-start max-w-[78%]">
            <Txt variant="body" tone="inv">What exactly did I agree to on the rate?</Txt>
          </Card>
          <Txt variant="body">
            You agreed to the 3 mm rate, not the old 2.5 mm quote — and only for batches of a
            thousand units or more.
          </Txt>
          <View className="flex-row gap-[6px]">
            <Chip label="↳ 11:08" tone="stamp" />
            <Chip label="↳ 11:14" tone="stamp" />
          </View>
          <AskBar
            value=""
            onChangeText={() => undefined}
            placeholder="Ask about this conversation…"
            className="mb-[16px]"
          />
        </View>
      </Sheet>
    </Screen>
  );
}
