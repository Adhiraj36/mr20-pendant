// Package mail sends the one transactional email this backend sends: the
// preorder confirmation, once an order first turns paid.
//
// lyzn.ai's verified SES identity lives in a different AWS account than
// this backend's own — DynamoDB, Secrets Manager and every other AWS call
// in this backend run under this Lambda's own role, which has no standing
// in that other account at all. So this package builds its client from a
// static access key pair (config.SES) rather than the ambient credential
// chain everything else here uses.
package mail

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
)

// Message is one email, plain text and HTML both — SES sends whichever the
// receiving client prefers.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Send delivers one email through the sender account's SES.
//
// Nothing here retries: the caller already has one, because the two places
// this is called from are Razorpay's webhook redelivery and the client's
// own verify — either would simply try again on its own schedule.
func Send(ctx context.Context, msg Message) error {
	accessKeyID, secretAccessKey, region, from, err := config.SES(ctx)
	if err != nil {
		return err
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		),
	)
	if err != nil {
		return fmt.Errorf("mail: building the SES client: %w", err)
	}

	client := sesv2.NewFromConfig(cfg)
	_, err = client.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(from),
		Destination:      &types.Destination{ToAddresses: []string{msg.To}},
		Content: &types.EmailContent{
			Simple: &types.Message{
				Subject: &types.Content{Data: aws.String(msg.Subject)},
				Body: &types.Body{
					Text: &types.Content{Data: aws.String(msg.Text)},
					Html: &types.Content{Data: aws.String(msg.HTML)},
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("mail: sending to %s: %w", msg.To, err)
	}
	return nil
}
