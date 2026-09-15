// Chat with the pendant's AI.
//
//	GET  /chats    conversation list, from our own rows, paged
//	POST /chat     one turn, streamed back as SSE
//
// The model is Claude Haiku on Bedrock through karma; gitloom-go's WrapKarma
// makes the conversation managed: the stored conversation supplies the
// window, memory is retrieved and injected as background, both turns are
// stored with real token usage, compaction runs on cadence, and compacted
// turns feed memory ingestion. The handler passes only the new message.
package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gl "github.com/GitLoomHQ/gitloom-go/gitloom"
	"github.com/MelloB1989/karma/ai"
	"github.com/MelloB1989/karma/models"
	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/enrich"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
)

const chatSystem = `You are Mira, the AI inside the Pendant app. The user wears a pendant that
records their real conversations; transcripts feed your long-term memory, and
remembered background may be provided to you alongside each question.

- You are Mira. Introduce yourself as Mira if asked who you are; never as an
  assistant model or a chatbot brand.
- Answer from the remembered background when it bears on the question, and say
  so naturally ("from your conversation on...") rather than citing sources
  formally. Do not invent memories: if you do not know, say you do not know.
- The memory comes from imperfect transcription of real speech; treat garbled
  fragments charitably and do not quote transcription errors back.
- Be concise and warm. This is a phone chat, not an essay.`

func chatModelID() string {
	if v := os.Getenv("CHAT_MODEL_ID"); v != "" {
		return v
	}
	return enrich.DefaultModelID
}

const voiceSystem = `You are Mira, and the user is TALKING to you out loud. Your reply is spoken
back through a voice — brevity is not a preference here, it is the medium.

- Answer in AT MOST three short sentences. Usually one or two is right. A
  spoken paragraph is a wall; keep it to what you would actually say out loud
  in a quick exchange.
- If the full answer is long, give only its heart and end by offering to go
  deeper ("want the details?"). Never dump the whole thing unprompted.
- No lists, headings, markdown, or bullet points — they cannot be spoken.
  Flowing sentences only.
- You are Mira; never mention being a model or a brand.
- Draw on the remembered background when it bears on what they said, naturally.
  Never invent memories; if you do not know, say so.
- The memory comes from imperfect transcription; treat garbled fragments
  charitably and never quote transcription errors back.`

var (
	wrapMu   sync.Mutex
	wrappers = map[string]*gl.WrappedKarma{}

	// toolEmit routes the wrapper's step events (memory retrieval) to the SSE
	// stream of the request in flight. One Lambda invoke serves one request,
	// so a single slot is enough; atomic keeps a stray late event harmless.
	toolEmit atomic.Pointer[func(gl.WrapEvent)]
)

func emitWrapEvent(e gl.WrapEvent) {
	if fn := toolEmit.Load(); fn != nil {
		(*fn)(e)
	}
}

// wrapperFor returns the per-user managed-karma wrapper. Per user because the
// namespace is the user's memory boundary; cached because the wrapper caches
// loaded conversations, which is what keeps a warm turn to one round trip.
func wrapperFor(ctx context.Context, userID string) (*gl.WrappedKarma, error) {
	return wrapperWith(ctx, userID, "", chatSystem, 2048)
}

// WrapperForVoice is the spoken-conversation wrapper: the same memory
// namespace and stored conversation as text, a system prompt for the ear,
// and a tighter token budget so replies stay speakable.
func WrapperForVoice(ctx context.Context, userID string) (*gl.WrappedKarma, error) {
	return wrapperWith(ctx, userID, voiceWrapperSuffix, voiceSystem, 220)
}

// voiceWrapperSuffix keys the spoken wrapper apart from the typed one. Named,
// because a cache with two keys and one eviction is how a deleted chat kept
// answering.
const voiceWrapperSuffix = ":voice"

func wrapperWith(ctx context.Context, userID, suffix, system string, maxReply int) (*gl.WrappedKarma, error) {
	wrapMu.Lock()
	defer wrapMu.Unlock()
	key := userID + suffix
	if w, ok := wrappers[key]; ok {
		return w, nil
	}

	client, err := gitloomx.Client(ctx)
	if err != nil {
		return nil, err
	}
	if err := gitloomx.EnsureNamespace(ctx, client, gitloomx.Namespace(userID)); err != nil {
		return nil, err
	}

	kai := ai.NewKarmaAI(
		ai.BaseModel(chatModelID()),
		ai.Bedrock,
		ai.WithSystemMessage(system),
		ai.WithTemperature(0.7),
		ai.WithMaxTokens(maxReply),
		// The one thing the assistant may *do* rather than say. Both wrappers
		// are built here, so the spoken one carries it too: "put that on my
		// laptop" is the same request out loud. Three passes is enough for
		// ask, file, report, and bounds what one turn can cost.
		ai.WithToolsEnabled(),
		ai.WithMaxToolPasses(3),
		ai.AddGoFunctionTool(sendTaskTool(userID)),
	)
	w := gl.WrapKarma(kai, client, gl.ConversationOptions{
		Namespace: gitloomx.Namespace(userID),
		Model:     chatModelID(),
		OnEvent:   emitWrapEvent,
		// Haiku 4.5's window is 200K; leave headroom for the reply and the
		// injected memory context.
		MaxTokens:       150_000,
		ReserveForReply: 4_096,
		// GitLoom's model compacts: the turns are already stored there, and
		// this Lambda should not spend Bedrock time summarising.
		SummarizeServer: true,
	})
	wrappers[key] = w
	return w, nil
}

func registerChatRoutes(app fiber.Router) {
	app.Get("/chats", listChats)
	app.Get("/chats/:id", chatHistory)
	app.Delete("/chats/:id", deleteChat)
	app.Post("/chat", chatTurn)
	app.Post("/chat/attachments", presignChatUpload)
}

// glConvID scopes a client-minted conversation id to its owner. Conversation
// ids reach GitLoom account-scoped, not namespace-scoped, so without this a
// guessed id could read or continue another user's chat. With the sub baked
// into the stored id, another user's requests resolve to ids under their own
// prefix — a 404, structurally.
func glConvID(userID, clientID string) string { return userID + "." + clientID }

// voiceConvPrefix marks a conversation the app opened for a spoken call. The
// app mints these ids (see the voice screen); the chat list filters them out.
const voiceConvPrefix = "voice-"

// GlConvID is the owner-scoped conversation id, exported for the voice
// service, which shares the chat machinery over a different transport.
func GlConvID(userID, clientID string) string { return glConvID(userID, clientID) }

// WrapperFor exposes the per-user managed-karma wrapper to the voice service.
func WrapperFor(ctx context.Context, userID string) (*gl.WrappedKarma, error) {
	return wrapperFor(ctx, userID)
}

// SetWrapEventSink routes the wrapper's step events (memory retrieval) to a
// transport's own emitter; the returned function restores the previous sink.
// One request is in flight per process at a time on Lambda; the voice
// service serializes turns per connection, so a plain swap is enough.
func SetWrapEventSink(fn func(gl.WrapEvent)) (restore func()) {
	previous := toolEmit.Load()
	if fn == nil {
		toolEmit.Store(nil)
	} else {
		toolEmit.Store(&fn)
	}
	return func() { toolEmit.Store(previous) }
}

// EagerIngest hands the just-finished exchange to memory immediately, so a
// fact said in this turn is retrievable in the next one. Best-effort.
func EagerIngest(ctx context.Context, wrapper *gl.WrappedKarma, chatID string) bool {
	conv, err := wrapper.Conversation(ctx, chatID)
	if err != nil {
		return false
	}
	next := conv.NextSeq()
	if next < 2 {
		return false
	}
	if err := conv.Ingest(ctx, next-2, next-1); err != nil {
		log.Printf("eager ingest failed conv=%s err=%v", chatID, err)
		return false
	}
	return true
}

// clientConvID strips the owner prefix for the wire; the app never sees it.
func clientConvID(userID, stored string) string {
	return strings.TrimPrefix(stored, userID+".")
}

// deleteChat removes the stored conversation. Memories already extracted from
// it survive in the user's namespace — deleting a chat is tidying the list,
// not asking the assistant to forget.
func deleteChat(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	client, err := gitloomx.Client(c.Context())
	if err != nil {
		return err
	}
	if err := client.DeleteConversation(c.Context(), glConvID(user, c.Params("id"))); err != nil {
		var apiErr *gl.APIError
		if errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound {
			return fiber.NewError(fiber.StatusNotFound, "no such conversation")
		}
		log.Printf("chat delete failed user=%s err=%v", user, err)
		return fiber.NewError(fiber.StatusBadGateway, "the conversation could not be deleted")
	}
	deleteChatMedia(c.Context(), user, c.Params("id"))
	// Evict every cached handle so a new chat can reuse the id cleanly. Both
	// of them: the voice wrapper is keyed user+":voice" and used to survive a
	// delete, so a spoken session went on answering from a conversation that
	// no longer existed until the container recycled.
	wrapMu.Lock()
	delete(wrappers, user)
	delete(wrappers, user+voiceWrapperSuffix)
	wrapMu.Unlock()
	// The metadata row is ours, not GitLoom's, so it has to go too or the
	// chat list keeps listing a thread with nothing behind it.
	if conv, err := ddb.GetConversation(c.Context(), user, c.Params("id")); err == nil && conv != nil {
		if err := ddb.DeleteConversationRow(c.Context(), user, *conv); err != nil {
			log.Printf("chat delete: conversation row survived user=%s err=%v", user, err)
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// chatHistory returns the stored turns of one conversation, so the app can
// reopen a chat where it left off. The window is what GitLoom holds live
// (post-compaction); older turns have been folded into memory.
func chatHistory(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	client, err := gitloomx.Client(c.Context())
	if err != nil {
		return err
	}
	conv, err := client.LoadConversation(c.Context(), glConvID(user, c.Params("id")), gl.ConversationOptions{
		Namespace: gitloomx.Namespace(user),
	})
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "no such conversation")
	}

	type message struct {
		Role        string       `json:"role"`
		Text        string       `json:"text"`
		Attachments []Attachment `json:"attachments,omitempty"`
	}
	history := conv.History("")
	messages := make([]message, 0, len(history.Messages))
	for _, m := range history.Messages {
		if m.Role != models.User && m.Role != models.Assistant {
			continue
		}
		// Stored turns carry their attachments as markers; hand the app
		// clean text plus presigned files.
		text, atts := parseAttachments(c.Context(), m.Message)
		messages = append(messages, message{Role: string(m.Role), Text: text, Attachments: atts})
	}
	return c.JSON(fiber.Map{"id": clientConvID(user, conv.ID), "title": conv.Title, "messages": messages})
}

// listChats reads the conversation rows this backend owns.
//
// It used to proxy GitLoom's own list, which caps at a hundred with no cursor
// and carries no field for anything the app needs to know about a thread. So
// whether a conversation was spoken was smuggled into its id as a "voice-"
// prefix and filtered out here by string match — a naming convention doing a
// schema's job, and one that could not have been paged past even if the
// endpoint allowed it. The rows carry kind, pinned, archived and the
// compaction counter, and they page.
//
// Voice and archived threads are filtered after the page is read, so a page
// can come back short — or empty — with a cursor still set. Follow the cursor
// until it is absent; that, and not an empty array, is the end of the list.
func listChats(c *fiber.Ctx) error {
	user := authjwt.Sub(c)

	limit := int32(0)
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = int32(v)
	}
	cursor := c.Query("cursor")

	convs, next, err := ddb.ListConversations(c.Context(), user, limit, cursor)
	if err != nil {
		return err
	}
	// An account that has chatted before this shipped has threads in GitLoom
	// and no rows here. Mint them once, from the list that is about to be
	// retired, so nobody's history disappears on deploy day.
	if len(convs) == 0 && cursor == "" {
		if backfilled := backfillConversations(c, user); backfilled > 0 {
			convs, next, err = ddb.ListConversations(c.Context(), user, limit, "")
			if err != nil {
				return err
			}
		}
	}

	chats := make([]ddb.Conversation, 0, len(convs))
	for _, conv := range convs {
		// A voice call shares the user's memory but is not a text thread —
		// listing it as one put spoken sessions in the chat list, where they
		// read as conversations the user never typed.
		if conv.Kind == ddb.ConversationVoice || conv.Archived {
			continue
		}
		chats = append(chats, conv)
	}
	out := fiber.Map{"chats": chats}
	if next != "" {
		out["cursor"] = next
	}
	return c.JSON(out)
}

// backfillConversations mints rows for threads that only GitLoom knows about,
// and reports how many it wrote. Best-effort: an unreachable GitLoom means an
// empty list this once, not a failed request.
func backfillConversations(c *fiber.Ctx, user string) int {
	remote, err := gitloomConversations(c, user)
	if err != nil {
		log.Printf("chat list backfill skipped user=%s err=%v", user, err)
		return 0
	}
	written := 0
	for _, conv := range remote {
		// Conversations that predate id scoping keep working: strip only when
		// the prefix is actually there.
		id := clientConvID(user, conv.ID)
		kind := ddb.ConversationText
		if strings.HasPrefix(id, voiceConvPrefix) {
			kind = ddb.ConversationVoice
		}
		updatedAt := conv.UpdatedAt
		if updatedAt == "" {
			updatedAt = nowISO()
		}
		row := ddb.Conversation{
			ID: id, Kind: kind, Title: conv.Title,
			CreatedAt: updatedAt, UpdatedAt: updatedAt,
		}
		if err := ddb.PutConversation(c.Context(), user, row, ""); err != nil {
			log.Printf("chat list backfill row failed user=%s id=%s err=%v", user, id, err)
			continue
		}
		written++
	}
	return written
}

type remoteConversation struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	UpdatedAt string `json:"updated_at"`
}

// gitloomConversations calls GitLoom's conversations endpoint directly — the
// Go SDK does not surface a list, and the endpoint is one GET. Only the
// backfill above needs it now.
func gitloomConversations(c *fiber.Ctx, user string) ([]remoteConversation, error) {
	client, err := gitloomx.Client(c.Context())
	if err != nil {
		return nil, err
	}
	if err := gitloomx.EnsureNamespace(c.Context(), client, gitloomx.Namespace(user)); err != nil {
		return nil, err
	}
	key, err := gitloomx.APIKey(c.Context())
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(c.Context(), http.MethodGet,
		gitloomx.BaseURL()+"/v1/conversations?namespace="+url.QueryEscape(gitloomx.Namespace(user)), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("conversation list failed (%d)", resp.StatusCode)
	}

	var body struct {
		Conversations []remoteConversation `json:"conversations"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Conversations, nil
}

type sseEvent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	// Tool events: which managed step is running and where it stands.
	Name   string `json:"name,omitempty"`   // e.g. "memory.recall"
	Status string `json:"status,omitempty"` // "start" | "done" | "failed"
	Hits   int    `json:"hits,omitempty"`
}

func writeEvent(w *bufio.Writer, event sseEvent) {
	raw, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", raw)
	w.Flush()
}

func chatTurn(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		ConversationID string       `json:"conversationId"`
		Message        string       `json:"message"`
		Attachments    []Attachment `json:"attachments"`
		// Kind is "text" or "voice"; anything else, or nothing, is text.
		// This is the field that replaced the "voice-" id prefix.
		Kind string `json:"kind"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	input.Message = strings.TrimSpace(input.Message)
	if input.ConversationID == "" || (input.Message == "" && len(input.Attachments) == 0) {
		return fiber.NewError(fiber.StatusBadRequest, "conversationId and a message or attachment are required")
	}
	if len(input.Attachments) > maxAttachmentsPerTurn {
		return fiber.NewError(fiber.StatusBadRequest,
			fmt.Sprintf("at most %d attachments per message", maxAttachmentsPerTurn))
	}
	if len(input.Message) > 8_000 {
		return fiber.NewError(fiber.StatusBadRequest, "message is too long")
	}
	// The conversation id is client-minted but namespaced per user by GitLoom
	// options; still keep ids to a sane shape so they read well in logs.
	if len(input.ConversationID) > 80 {
		return fiber.NewError(fiber.StatusBadRequest, "conversationId is too long")
	}

	kind := ddb.CoerceConversationKind(input.Kind)

	wrapper, err := wrapperFor(c.Context(), user)
	if err != nil {
		log.Printf("chat wrapper init failed user=%s err=%v", user, err)
		return fiber.NewError(fiber.StatusBadGateway, "the assistant is unavailable right now")
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	// Attachments become model-visible content (data URLs for karma's Bedrock
	// path) and storage-visible markers appended to the turn text, so history
	// and its compaction carry them without a parallel store.
	var images, files []string
	message := input.Message
	for _, att := range input.Attachments {
		dataURL, isImage, err := loadAttachment(c.Context(), user, input.ConversationID, att)
		if err != nil {
			log.Printf("chat attachment rejected user=%s key=%s err=%v", user, att.Key, err)
			return fiber.NewError(fiber.StatusBadRequest, "an attachment could not be read — re-attach and try again")
		}
		if isImage {
			images = append(images, dataURL)
		} else {
			files = append(files, dataURL)
		}
		message += attachmentMarker(att)
	}

	c.Context().SetBodyStreamWriter(fasthttp.StreamWriter(func(w *bufio.Writer) {
		history := models.AIChatHistory{
			ChatId: glConvID(user, input.ConversationID),
			Messages: []models.AIMessage{{
				Role: models.User, Message: message,
				Images: images, Files: files,
				Timestamp: time.Now(),
			}},
		}

		// The wrapper's managed steps surface as tool events on this stream.
		emit := func(e gl.WrapEvent) {
			ev := sseEvent{Type: "tool", Name: e.Kind, Status: "done", Hits: e.Hits}
			switch {
			case e.Kind == "memory.recall":
				ev.Name, ev.Status = "memory.recall", "start"
			case e.Err != nil:
				ev.Status = "failed"
			case e.Kind == "memory.recall.done":
				ev.Name = "memory.recall"
			}
			writeEvent(w, ev)
		}
		toolEmit.Store(&emit)
		defer toolEmit.Store(nil)

		_, err := wrapper.ChatCompletionStream(history, func(chunk models.StreamedResponse) error {
			if chunk.AIResponse != "" {
				writeEvent(w, sseEvent{Type: "delta", Text: chunk.AIResponse})
			}
			return nil
		})
		if err != nil {
			log.Printf("chat turn failed user=%s conv=%s err=%v", user, input.ConversationID, err)
			writeEvent(w, sseEvent{Type: "error", Text: "Mira could not answer. Try again."})
			return
		}

		// Remember as you go: hand the exchange that just landed to memory
		// immediately, so a fact told to Mira in this chat is retrievable in
		// the next one within seconds. Synchronous, and BEFORE the done event
		// — the reply text is already complete, the client shows this as a
		// tool step, and Lambda freezes the container the moment this writer
		// returns, so a goroutine here simply never runs (learned by watching
		// one not run). The idle sweep remains the backstop; overlaps
		// reconcile rather than duplicate.
		func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			conv, err := wrapper.Conversation(ctx, history.ChatId)
			if err != nil {
				return
			}
			if next := conv.NextSeq(); next >= 2 {
				writeEvent(w, sseEvent{Type: "tool", Name: "memory.ingest", Status: "start"})
				if err := conv.Ingest(ctx, next-2, next-1); err != nil {
					log.Printf("eager ingest failed conv=%s err=%v", history.ChatId, err)
					writeEvent(w, sseEvent{Type: "tool", Name: "memory.ingest", Status: "failed"})
				} else {
					writeEvent(w, sseEvent{Type: "tool", Name: "memory.ingest", Status: "done"})
				}
			}

			// Count the exchange where a frozen container cannot lose it, and
			// compact when the count says so. gitloom-go decides this from
			// per-process fields and Load resets them, so on Lambda the
			// built-in cadence fires only if one warm container happens to
			// serve five turns of the same chat — which is to say almost
			// never, and the window grows until it overflows instead.
			//
			// Its own budget: a compaction is a model call on GitLoom's side
			// and must not be cut short by the ingest's deadline.
			bookkeeping, done := context.WithTimeout(context.Background(), 25*time.Second)
			defer done()
			recordExchange(bookkeeping, w, user, input.ConversationID, kind, conv, input.Message)
		}()
		writeEvent(w, sseEvent{Type: "done"})
	}))
	return nil
}

// titleFromQuestion is the first question, trimmed to something that fits a
// row: whole words, no trailing punctuation, and never longer than the row
// can show. An empty question leaves the title empty rather than inventing
// one — a thread with no words in it has no name to take.
func titleFromQuestion(question string) string {
	q := strings.Join(strings.Fields(question), " ")
	if q == "" {
		return ""
	}
	const most = 48
	if len(q) > most {
		cut := strings.LastIndex(q[:most], " ")
		if cut < most/2 {
			cut = most
		}
		q = strings.TrimRight(q[:cut], " ,;:-") + "…"
	}
	return strings.TrimRight(q, " ?.!,")
}

// recordExchange bumps the durable exchange counter and compacts on cadence.
//
// Compaction is caller-triggered in gitloom-go and its trigger is per-process,
// which is the wrong lifetime for a Lambda: a cold container starts at zero and
// the "every five exchanges" rule effectively never fires. Counting in
// DynamoDB is what makes the cadence real. Each compaction costs one chat on
// GitLoom's meter, so the cadence is a price as well as a threshold — hence
// counting exactly, and resetting only when one actually happened.
//
// Best-effort throughout: the reply is already written and the turn is already
// stored. A conversation whose window is one exchange late is fine; a turn
// that failed because bookkeeping did is not.
func recordExchange(ctx context.Context, w *bufio.Writer, user, conversationID string,
	kind ddb.ConversationKind, conv *gl.Conversation, question string) {
	// A thread with no name is every thread called the same thing. GitLoom
	// titles a conversation on its own schedule and often not at all, so the
	// first question stands in until it does — it is what the person actually
	// asked, which is a better name than anything generated would be.
	title := conv.Title
	if title == "" {
		title = titleFromQuestion(question)
	}
	row, err := ddb.TouchConversation(ctx, user, conversationID, kind, title)
	if err != nil {
		log.Printf("conversation row update failed user=%s conv=%s err=%v", user, conversationID, err)
		return
	}
	if !ddb.DueForCompaction(row.Exchanges) {
		return
	}

	writeEvent(w, sseEvent{Type: "tool", Name: "memory.compact", Status: "start"})
	if _, err := conv.Compact(ctx); err != nil {
		log.Printf("compaction failed conv=%s err=%v", conversationID, err)
		writeEvent(w, sseEvent{Type: "tool", Name: "memory.compact", Status: "failed"})
		return
	}
	if err := ddb.ResetConversationExchanges(ctx, user, row); err != nil {
		log.Printf("compaction counter not reset conv=%s err=%v", conversationID, err)
	}
	writeEvent(w, sseEvent{Type: "tool", Name: "memory.compact", Status: "done"})
}
