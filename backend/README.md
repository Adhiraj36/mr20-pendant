# Backend

Serverless ingest, transcription and enrichment for the MR20 pendant. Everything
is on-demand: idle cost is the S3 storage and nothing else.

```
phone ──PUT──▶ S3 ──event──▶ SQS ──▶ processor ──▶ Deepgram (transcribe + diarize)
                                          │                    │
                                          │                    ▼
                                          │              Bedrock Claude
                                          │        (title, tags, summary, actions)
                                          ▼
                                     DynamoDB ◀──── HTTP API ◀── phone
```

## Pieces

| Resource | Purpose |
|---|---|
| DynamoDB (single table) | Devices, recordings and preferences |
| S3 | Audio under `audio/<sub>/<id>.mp3`, transcripts under `transcripts/…` |
| SQS + DLQ | Decouples upload from transcription; 4 attempts, then the reaper marks the row failed |
| Lambda × 3 | The Fiber API, the processor, the DLQ reaper |
| Function URL | Streaming, fronted by CloudFront at `api.lyzn.ai` |
| Secrets Manager | Deepgram, Sarvam, GitLoom and Clerk keys |

## Stacks

| Stack | What it is |
|---|---|
| `Mr20PendantStack` | Production: the data plane, the Lambdas, `api.lyzn.ai`. The live voice service (Fargate behind an ALB) is parked and only synthesised with `-c voice=true` |
| `LyznWebStack` | The lyzn.ai site: S3 behind CloudFront |
| `Mr20PendantPreview-pr-<n>` | One pull request's ephemeral backend, raised by the `preview` label |

There is one CDK app, so `cdk deploy` needs a target or `--all`; `npm run deploy`
passes `--all`. A preview stack only exists in the app when `-c previewPr=<n>`
says so, which is why an ordinary deploy can neither raise nor disturb one.

## Configuration

**Try a change on a preview, not on your laptop.** Label the pull request
`preview` and it gets a real backend on real infrastructure — the same Lambdas,
the same queue, its own empty table — with the URL commented on the pull
request. Running this locally means standing up DynamoDB, S3, SQS and Bedrock
credentials to approximate something a label already gives you in two minutes,
against test credentials that cannot touch production. See the root README.

`internal/config` is the one description of everything the backend reads from
its environment: every variable as a tagged field on a single struct, loaded
through `karma/config`. It exists so no one has to grep for `os.Getenv` to learn
what a function needs, and so the CDK and the code cannot disagree about a name.

Every credential resolves the same way, through `config.Resolve`: a plain
variable if one is set, otherwise the Secrets Manager ARN the stack injects.
Resolved secrets are cached for the container's life — the alternative is a
Secrets Manager call per invocation, which is slower and billed — and a secret
still holding the `REPLACE_ME` placeholder the stack created it with is reported
as exactly that, rather than left for the provider to reject as a bad
credential.

Almost every field is optional, deliberately: each Lambda is given only the
handful it needs, so a variable required by the API is absent for the processor.
Requiring them centrally would make every function refuse to start over
something it never reads.

| Credential | Plain variable | Secret ARN the stack injects | Production | Staging |
|---|---|---|---|---|
| Clerk | `CLERK_SECRET_KEY` | `CLERK_SECRET_ARN` | `mr20/clerk/prod` | `mr20/clerk/test` |
| Razorpay | `RAZORPAY_KEY_ID` + `_SECRET` | `RAZORPAY_SECRET_ARN` | `mr20/razorpay/prod` | `mr20/razorpay/test` |
| Deepgram | `DEEPGRAM_API_KEY` | `DEEPGRAM_SECRET_ARN` | stack-created | *same as production* |
| Sarvam | `SARVAM_API_KEY` | `SARVAM_SECRET_ARN` | stack-created | *same as production* |
| GitLoom | `GITLOOM_API_KEY` | `GITLOOM_SECRET_ARN` | `mr20/gitloom` | *same as production* |

## Data model

The table, the audio bucket and the ingest queue are defined once, in
`lib/data-plane.ts`, and built by both the production stack and every preview.
Anything added there — another table, an index, a changed key — reaches previews
on their next deploy without being copied across, so a preview always tests the
schema production actually has.

Only durability differs between the two: production retains and keeps
point-in-time recovery; a preview deletes and empties its bucket with the stack.

`createDataPlane` is a function rather than a Construct deliberately. A
Construct would nest those resources and change their logical ids, and
CloudFormation treats a changed logical id as a different resource — it would
replace the production table. Called with the stack as its scope, the ids are
what they have always been.


Single table, on-demand.

| Item | PK | SK | GSI1PK |
|---|---|---|---|
| Device | `USER#<sub>` | `DEVICE#<mac>` | — |
| Recording | `USER#<sub>` | `REC#<startedAt>#<id>` | `REC#<id>` |
| Prefs | `USER#<sub>` | `PREFS` | — |

`<sub>` is the Clerk user id, `user_…`.

The sort key leads with `startedAt` so a Query returns a user's recordings in
order with no sort step. GSI1 exists because the processor only knows the
recording id — it comes out of the S3 key — and would otherwise need a scan.

Full transcripts live in S3, not DynamoDB: an hour of speech with word timings
runs to a few hundred KB and would crowd the 400 KB item limit. The row keeps a
capped, lowercased `searchBlob` for the search filter.

## Auth

Clerk, outright. The app signs in against Clerk and sends the session token;
Fiber middleware verifies it against the issuer's JWKS and reads the user id
from the `sub` claim. There is nothing else in the path — no user pool, no
password, no sign-in code, and no secret the API needs in order to verify.

Which instance is trusted is `CLERK_ISSUER`, set in the stack rather than left
to the code's default, so it is visible and changeable without a release.
Staging trusts the test instance instead, which is a different issuer with
different signing keys: a production token is rejected there outright.

`CLERK_SECRET_ARN` points at that instance's backend API key, for calling Clerk
back — reading a user, revoking a session. Verifying a token does not need it.

## Deploy

```bash
npm install
npx cdk deploy
../sync-config.sh          # copy the outputs into the app
```

Set the Deepgram key once:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(aws cloudformation describe-stacks --stack-name Mr20PendantStack \
      --query "Stacks[0].Outputs[?OutputKey=='DeepgramSecretArn'].OutputValue" --output text)" \
  --secret-string '{"apiKey":"YOUR_DEEPGRAM_KEY"}' \
  --region ap-south-1
```

The processor caches the key per container, so a change takes effect on the next
cold start — or immediately if you bump the function's environment.

### Context overrides

`voice=true` puts the live voice service back into the stack: the VPC, the
Fargate task, its ALB and the `VoiceUrl` output the app reads. It is off by
default since 2026-09-15, when live voice chat was parked and the ALB removed
from the console; with the flag off, `sync-config.sh` writes an empty
`voiceUrl` and the app treats voice as not deployed.

```bash
npx cdk deploy \
  -c bedrockModelId=global.anthropic.claude-sonnet-5 \
  -c clerkIssuer=https://clerk.example.com
```

`bedrockModelId` defaults to Sonnet 4.5, which this account can already invoke.
Sonnet 5 needs model access enabling in the Bedrock console first.

## Routes

All behind the JWT authorizer. `sub` comes from the token, never the body.

| Method | Path | Notes |
|---|---|---|
| POST | `/devices` | Pair; re-pairing keeps the original `pairedAt` |
| GET | `/devices` | |
| PATCH | `/devices/{mac}` | Telemetry from a BLE read |
| DELETE | `/devices/{mac}` | Recordings already synced are kept |
| POST | `/recordings` | Register a device file, returns a presigned PUT |
| POST | `/recordings/{id}/uploaded` | Moves the UI off "pending" without waiting for the queue |
| GET | `/recordings` | Newest first, cursor paginated |
| GET | `/recordings/{id}` | Transcript inlined from S3 |
| GET | `/recordings/{id}/audio` | Presigned playback URL, 6 h |
| PATCH | `/recordings/{id}` | Title, tags, speaker names. A recording also carries `speakerProfiles`, the pipeline's own label and one-line description per voice; the app shows a label wherever the user has not named that voice, and only `speakers` is ever sent to memory |
| POST | `/recordings/{id}/retry` | Re-queues a failed transcription; the audio is still in S3 |
| DELETE | `/recordings/{id}` | Removes the row, the audio and the transcript |
| GET | `/search?q=` | Substring match over title, tags, summary and transcript |
| POST | `/orders` | Prices a basket server-side and starts a Razorpay checkout |
| POST | `/orders/{reference}/verify` | Confirms the signature Checkout returned; idempotent once paid |
| GET | `/orders/{reference}` | One order, if it is the caller's |
| GET | `/plan` | The caller's current entitlement |
| PUT | `/admin/config` | Replaces the application configuration; needs Clerk `public_metadata.role == "admin"`. See `scripts/config.md` |

| Method | Path | Notes |
|---|---|---|
| POST | `/webhooks/razorpay` | **Not behind the JWT authorizer.** Razorpay's own HMAC over the raw body stands in for auth |
| GET | `/config` | **Public.** Prices, tier copy, feature flags, notification hour — the one document the app and the website both read. Cached sixty seconds at CloudFront and by the client; ETag |

## Transcript correction and speakers

Two engines hear the same audio: Deepgram (diarization and timing, required)
and Sarvam (a second reading of the words, best-effort). The extraction agent
then reads every utterance as a listener would and writes `corrections.json`:
it corrects from Sarvam's reading where that clearly heard better, and from
the conversation's own context where a word is plainly a mishearing of
something already established — garbled words, wrong names, dropped words,
the wrong script. It keeps the speaker's grammar and language mix, never
paraphrases, and keeps the original when the evidence does not decide it.
The Bedrock fallback's merge prompt follows the same rules.

The agent also writes `speakers.json`: a label and a one-sentence description
per diarizer index. A label is a name only when the conversation itself
establishes it; otherwise it is the role (Doctor, Auto driver). These land on
the row as `speakerProfiles`, beside — never inside — the user's own
`speakers` map.

Enhancement (DeepFilterNet, then silence cutting) runs before both engines.
`AUDIO_ENHANCE=off` on ProcessorFn skips it, so the engines hear the original
and the app plays it, for A/B-ing transcript quality without a redeploy of
the binaries.

## Failure handling

The processor splits failures in two. A bad request to Deepgram, or an unset
API key, is permanent: the row is marked `failed` with the reason and the SQS
message is acknowledged, because retrying would fail identically. A 429, a 5xx
or a Bedrock throttle is retryable: the message is returned to the queue and
redelivered, up to four times, after which the DLQ reaper marks the row failed
so it does not sit on `processing` forever.

Bedrock is treated as optional. If enrichment fails for a reason that is not
worth retrying, the transcript is still saved and the recording still goes
`ready` — a conversation you can read beats one stuck in the pipeline.

## Cost

Per hour of recorded audio, roughly:

| | |
|---|---|
| Deepgram Nova-3 | ~$0.26 |
| Bedrock Sonnet 4.5 enrichment | ~$0.05 |
| S3 storage (14 MB at 32 kbps) | ~$0.0003/month |
| Lambda, SQS, DynamoDB, API Gateway | fractions of a cent |

Nothing bills while idle.
