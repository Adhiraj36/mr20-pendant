// Package config is the one description of everything this backend reads from
// its environment.
//
// It exists so that nobody has to grep for os.Getenv to find out what a
// function needs, and so the stack and the code cannot drift apart over the
// spelling of a variable. It is not an invitation to run this backend on a
// laptop: doing that means standing up DynamoDB, S3, SQS and Bedrock to
// approximate what labelling a pull request `preview` gives you in two minutes
// on the real infrastructure, against credentials that cannot touch
// production.
//
// Every credential resolves the same way — Resolve takes a plain variable if
// one is set and otherwise reads the Secrets Manager ARN the stack injects, so
// the deployed path and any override share one implementation instead of the
// three that used to exist.
//
// Nothing here reaches AWS at import time. Fields are strings because that is
// what an environment holds; parsing belongs to whoever needs the value.
package config

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	karma "github.com/MelloB1989/karma/config"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// Backend is every environment variable the backend reads.
//
// Almost all are optional, and deliberately: each Lambda is given only the
// handful it needs, so a field that is required for the API is absent for the
// processor and vice versa. Requiring them here would make every function fail
// to start over a variable it never uses. What a value's absence means is the
// caller's business.
type Backend struct {
	// -- plumbing, injected by CDK -------------------------------------
	TableName      string `env:"TABLE_NAME"       optional:"true"`
	AudioBucket    string `env:"AUDIO_BUCKET"     optional:"true"`
	IngestQueueURL string `env:"INGEST_QUEUE_URL" optional:"true"`
	Port           string `env:"PORT"             optional:"true" default:"8080"`
	AWSRegion      string `env:"AWS_REGION"       optional:"true" default:"ap-south-1"`

	// Set on a preview, absent in production. The credentials below are the
	// test instance's when it is true — see ENVIRONMENTS in bin/app.ts.
	Staging string `env:"STAGING" optional:"true" default:"false"`

	// -- Clerk: the only thing that authenticates anyone ----------------
	// Verifying a session token needs the issuer's public JWKS and nothing
	// else. The secret is for calling Clerk back.
	ClerkIssuer    string `env:"CLERK_ISSUER"     optional:"true" default:"https://clerk.lyzn.ai"`
	ClerkSecretKey string `env:"CLERK_SECRET_KEY" optional:"true"`
	ClerkSecretARN string `env:"CLERK_SECRET_ARN" optional:"true"`

	// -- transcription --------------------------------------------------
	DeepgramAPIKey    string `env:"DEEPGRAM_API_KEY"    optional:"true"`
	DeepgramSecretARN string `env:"DEEPGRAM_SECRET_ARN" optional:"true"`
	DeepgramModel     string `env:"DEEPGRAM_MODEL"      optional:"true"`
	DeepgramLanguage  string `env:"DEEPGRAM_LANGUAGE"   optional:"true"`

	SarvamAPIKey    string `env:"SARVAM_API_KEY"    optional:"true"`
	SarvamSecretARN string `env:"SARVAM_SECRET_ARN" optional:"true"`
	SarvamModel     string `env:"SARVAM_MODEL"      optional:"true"`
	SarvamLanguage  string `env:"SARVAM_LANGUAGE"   optional:"true"`

	// -- memory ----------------------------------------------------------
	GitLoomAPIKey    string `env:"GITLOOM_API_KEY"    optional:"true"`
	GitLoomSecretARN string `env:"GITLOOM_SECRET_ARN" optional:"true"`
	GitLoomBaseURL   string `env:"GITLOOM_BASE_URL"   optional:"true"`

	// -- payments ---------------------------------------------------------
	// One secret holds all three: key id, key secret, and the webhook signing
	// secret. Test keys on a preview, live keys in production.
	RazorpayKeyID          string `env:"RAZORPAY_KEY_ID"          optional:"true"`
	RazorpayKeySecret      string `env:"RAZORPAY_KEY_SECRET"      optional:"true"`
	RazorpaySecretARN      string `env:"RAZORPAY_SECRET_ARN"      optional:"true"`
	RazorpayPlanAutomation string `env:"RAZORPAY_PLAN_AUTOMATION" optional:"true"`

	// -- mail --------------------------------------------------------------
	// lyzn.ai's verified SES identity lives in a different AWS account than
	// this backend's own — DynamoDB, Secrets Manager, everything else here
	// is 788655295054's; the sender is 022499029734's. So this is the one
	// credential in this file that is a full access key pair rather than an
	// API token, and internal/mail builds its SES client from it explicitly
	// rather than letting the SDK fall back to this Lambda's own role, which
	// has no standing in the other account at all.
	SESAccessKeyID     string `env:"SES_ACCESS_KEY_ID"     optional:"true"`
	SESSecretAccessKey string `env:"SES_SECRET_ACCESS_KEY" optional:"true"`
	SESRegion          string `env:"SES_REGION"            optional:"true"`
	SESFrom            string `env:"SES_FROM"              optional:"true"`
	SESSecretARN       string `env:"SES_SECRET_ARN"        optional:"true"`

	// -- models -----------------------------------------------------------
	BedrockModelID string `env:"BEDROCK_MODEL_ID" optional:"true"`
	ChatModelID    string `env:"CHAT_MODEL_ID"    optional:"true"`

	// -- audio tooling, bundled into the processor's asset ----------------
	FFmpegPath          string `env:"FFMPEG_PATH"            optional:"true"`
	DeepFilterPath      string `env:"DEEP_FILTER_PATH"       optional:"true"`
	DeepFilterAttenLim  string `env:"DEEP_FILTER_ATTEN_LIM"  optional:"true"`
	AudioPresenceGainDB string `env:"AUDIO_PRESENCE_GAIN_DB" optional:"true"`
}

// App is the singleton. Prefer Get, which loads it on first use.
var App = karma.NewAppConfig[*Backend]()

var loadOnce sync.Once

// Get returns the loaded configuration.
//
// Loading cannot fail in a way worth propagating: every field is optional, so
// the result is the defaults plus whatever the real environment holds — which
// on Lambda is everything that matters.
func Get() *Backend {
	loadOnce.Do(func() { _ = App.Load() })
	return App.Get()
}

// IsStaging reports whether this is a preview environment running on test
// credentials.
func IsStaging() bool { return strings.EqualFold(Get().Staging, "true") }

// SecretRef is one credential and the two places it can come from.
type SecretRef struct {
	// Direct is the value straight from the environment, when something sets
	// one. The deployed path is the ARN below.
	Direct string
	// ARN is the Secrets Manager secret to read when Direct is empty.
	ARN string
	// Fields are the JSON keys to try, in order, when the secret holds an
	// object rather than a bare string. Both shapes are in use.
	Fields []string
	// Name identifies the credential in errors.
	Name string
}

var (
	secretMu    sync.Mutex
	secretCache = map[string]string{}
	smClient    *secretsmanager.Client
)

// Resolve returns a credential, preferring the environment over AWS.
//
// A Lambda container is reused, so a resolved secret is cached for its life:
// the alternative is a Secrets Manager call on every invocation, which is both
// slower and billed.
func Resolve(ctx context.Context, ref SecretRef) (string, error) {
	if v := strings.TrimSpace(ref.Direct); v != "" {
		return v, nil
	}
	if ref.ARN == "" {
		return "", fmt.Errorf("%s: neither its environment variable nor its secret ARN is set", ref.Name)
	}

	secretMu.Lock()
	defer secretMu.Unlock()
	if v, ok := secretCache[ref.ARN]; ok {
		return v, nil
	}

	raw, err := fetch(ctx, ref.ARN)
	if err != nil {
		return "", fmt.Errorf("%s: %w", ref.Name, err)
	}

	value := raw
	if strings.HasPrefix(raw, "{") {
		var parsed map[string]string
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return "", fmt.Errorf("%s: secret is neither a bare string nor a JSON object: %w", ref.Name, err)
		}
		value = ""
		for _, k := range ref.Fields {
			if v := strings.TrimSpace(parsed[k]); v != "" {
				value = v
				break
			}
		}
		if value == "" {
			return "", fmt.Errorf("%s: secret holds none of the fields %v", ref.Name, ref.Fields)
		}
	}
	if value == "" {
		return "", fmt.Errorf("%s: secret is empty", ref.Name)
	}
	// The CDK creates these secrets with a generated placeholder and expects
	// the real key to be put in afterwards. Saying so is far better than
	// letting the provider reject it as a bad credential.
	if value == placeholder {
		return "", fmt.Errorf("%s: still holds the placeholder the stack created it with; put the real key in %s", ref.Name, ref.ARN)
	}

	secretCache[ref.ARN] = value
	return value, nil
}

// What generateSecretString writes into a freshly created secret.
const placeholder = "REPLACE_ME"

// ResolveObject returns a whole JSON secret, for credentials that are a pair
// rather than a single string — Razorpay's key id and secret, say.
func ResolveObject(ctx context.Context, arn, name string) (map[string]string, error) {
	if arn == "" {
		return nil, fmt.Errorf("%s: no secret ARN is set", name)
	}
	raw, err := fetch(ctx, arn)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	var parsed map[string]string
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("%s: secret is not a JSON object: %w", name, err)
	}
	return parsed, nil
}

func fetch(ctx context.Context, arn string) (string, error) {
	if smClient == nil {
		cfg, err := awsconfig.LoadDefaultConfig(ctx)
		if err != nil {
			return "", err
		}
		smClient = secretsmanager.NewFromConfig(cfg)
	}
	out, err := smClient.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: &arn})
	if err != nil {
		return "", err
	}
	if out.SecretString == nil {
		return "", fmt.Errorf("secret has no string value")
	}
	return strings.TrimSpace(*out.SecretString), nil
}

// Named credentials. Each names the env variable a developer would set and the
// ARN Lambda is given, so no caller has to remember the pairing.

func GitLoomAPIKey(ctx context.Context) (string, error) {
	c := Get()
	return Resolve(ctx, SecretRef{
		Name: "GitLoom API key", Direct: c.GitLoomAPIKey, ARN: c.GitLoomSecretARN,
		Fields: []string{"apiKey", "GITLOOM_API_KEY", "key"},
	})
}

func DeepgramAPIKey(ctx context.Context) (string, error) {
	c := Get()
	return Resolve(ctx, SecretRef{
		Name: "Deepgram API key", Direct: c.DeepgramAPIKey, ARN: c.DeepgramSecretARN,
		Fields: []string{"apiKey", "key"},
	})
}

func SarvamAPIKey(ctx context.Context) (string, error) {
	c := Get()
	return Resolve(ctx, SecretRef{
		Name: "Sarvam API key", Direct: c.SarvamAPIKey, ARN: c.SarvamSecretARN,
		Fields: []string{"apiKey", "key"},
	})
}

func ClerkSecretKey(ctx context.Context) (string, error) {
	c := Get()
	return Resolve(ctx, SecretRef{
		Name: "Clerk secret key", Direct: c.ClerkSecretKey, ARN: c.ClerkSecretARN,
		Fields: []string{"secretKey", "apiKey", "key"},
	})
}

// Razorpay returns the key id, key secret, and webhook signing secret
// together: they are issued as a triple and no part is useful alone. A
// missing webhookSecret is not an error here — it only matters to whoever
// calls VerifyWebhook, and an empty secret makes that verification refuse
// rather than panic.
func Razorpay(ctx context.Context) (id string, secret string, webhookSecret string, err error) {
	c := Get()
	if c.RazorpayKeyID != "" && c.RazorpayKeySecret != "" {
		return c.RazorpayKeyID, c.RazorpayKeySecret, "", nil
	}
	parsed, err := ResolveObject(ctx, c.RazorpaySecretARN, "Razorpay credentials")
	if err != nil {
		return "", "", "", err
	}
	id, secret = strings.TrimSpace(parsed["keyId"]), strings.TrimSpace(parsed["keySecret"])
	if id == "" || secret == "" {
		return "", "", "", fmt.Errorf("Razorpay credentials: secret holds no keyId/keySecret pair")
	}
	webhookSecret = strings.TrimSpace(parsed["webhookSecret"])
	return id, secret, webhookSecret, nil
}

// SES returns the access key, secret key, region and From address for
// lyzn.ai's verified sending identity. Region defaults to ap-south-1, same
// as everything else here, when the secret does not carry one.
func SES(ctx context.Context) (accessKeyID, secretAccessKey, region, from string, err error) {
	c := Get()
	if c.SESAccessKeyID != "" && c.SESSecretAccessKey != "" && c.SESFrom != "" {
		region = c.SESRegion
		if region == "" {
			region = "ap-south-1"
		}
		return c.SESAccessKeyID, c.SESSecretAccessKey, region, c.SESFrom, nil
	}
	parsed, err := ResolveObject(ctx, c.SESSecretARN, "SES credentials")
	if err != nil {
		return "", "", "", "", err
	}
	accessKeyID = strings.TrimSpace(parsed["accessKeyId"])
	secretAccessKey = strings.TrimSpace(parsed["secretAccessKey"])
	from = strings.TrimSpace(parsed["from"])
	if accessKeyID == "" || secretAccessKey == "" || from == "" {
		return "", "", "", "", fmt.Errorf("SES credentials: secret holds no accessKeyId/secretAccessKey/from")
	}
	region = strings.TrimSpace(parsed["region"])
	if region == "" {
		region = "ap-south-1"
	}
	return accessKeyID, secretAccessKey, region, from, nil
}
