# Running the whole daemon flow on one machine

The daemon half of the API is the part nobody can try from the app. It wants a
laptop holding a bearer token, and the token only exists once a six-character
code has been redeemed — so "does the handshake actually work" is a question
that needs a laptop, an account with automation, and a task somebody approved.

This is how to have all three in about two minutes, with no AWS account and
nothing of anybody's touched. It is exactly the run that proved the KARMAX
connector on 9 September 2026.

## 1. A table

```bash
docker run -d --name lyzn-ddb -p 8000:8000 amazon/dynamodb-local:latest

export AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local
export AWS_REGION=ap-south-1 AWS_ENDPOINT_URL=http://127.0.0.1:8000
export TABLE_NAME=lyzn-local

aws dynamodb create-table --table-name "$TABLE_NAME" \
  --attribute-definitions \
      AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
      'IndexName=GSI1,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  --billing-mode PAY_PER_REQUEST --query 'TableDescription.TableStatus' --output text
```

The one GSI is not optional: the work queue, the token lookup and the lease
sweep are all queries against it.

## 2. An account, a conversation, two promises and a code

```bash
go run ./cmd/localseed
# PAIRCODE YC884L
# USER user_local_test
```

It writes a plan carrying automation, a `ready` conversation with a title, a
summary and a fact, two `approved` tasks, and a pairing code. It refuses to
run unless `AWS_ENDPOINT_URL` points at loopback, because the one thing it
must never do is mint a free plan on production.

## 3. The API

```bash
EXECUTION_ENABLED=true PORT=8081 go run ./cmd/api
curl -s localhost:8081/health   # {"ok":true,"staging":false}
```

`EXECUTION_ENABLED` is the deployment half of the automation gate and wins
over the stored configuration, so a local run needs no config document. The S3
and SQS clients are built at boot and never called by these routes, so the
fake credentials above are enough.

## 4. A laptop

From a KARMAX checkout carrying the `lyzn` connector:

```bash
LYZN_API=http://127.0.0.1:8081 \
LYZN_PAIR_CODE=YC884L \
LYZN_LIVE_WORK=1 \
go test ./internal/connectors/lyzn/ -run Live -v
```

That redeems the code, beats, polls, claims the oldest promise, reports it
done, and asserts a receipt came back — and that posting the same result twice
returns the first receipt rather than printing a second one.

Or by hand, with the walkthrough in `backend/docs/daemon-api.md` §5, which is
the same sequence in curl.

## 5. What to look at afterwards

```bash
aws dynamodb query --table-name "$TABLE_NAME" \
  --key-condition-expression 'PK = :p' \
  --expression-attribute-values '{":p":{"S":"USER#user_local_test"}}' \
  --output json
```

The daemon row should be `online` with a heartbeat inside the last ninety
seconds and the capabilities the laptop reported; one task `done` carrying a
`receiptId`; the other still `approved`; and a receipt whose rows name the
machine it ran on.

## Tearing it down

```bash
docker rm -f lyzn-ddb
```

Everything lived in the container. There is nothing else to clean up.
