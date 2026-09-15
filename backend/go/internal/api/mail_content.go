// The preorder confirmation email — the one message this backend sends,
// the moment an order first turns paid. See orders.go's use of
// ddb.MarkOrderPaid's justPaid for why "first" is an atomic DynamoDB
// condition and not a read this file trusts on its own.
package api

import (
	"context"
	"fmt"
	"log"
	"strconv"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/mail"
)

// formatRupees is ₹8,999 — comma-grouped, no decimals, same reading as the
// web's money() in packages/design/src/money.ts. Plain thousands grouping
// rather than Indian lakh grouping: every figure this backend ever prints
// is a tier price or a sum of them, all under ₹1,00,000, where the two
// groupings agree.
func formatRupees(amount int) string {
	digits := strconv.Itoa(amount)
	neg := ""
	if digits[0] == '-' {
		neg, digits = "-", digits[1:]
	}
	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}
	return neg + "₹" + digits
}

// preorderConfirmationEmail is the receipt, in the site's own words — the
// same "Reserved. Your place in Batch 01 is held." line the paysheet prints
// once payment completes (web/src/data/content.ts, PRICING.form.done.line),
// and the same field names the paysheet's own slip uses (deposit, balance
// on dispatch). It does not repeat the site's ship-quarter copy: that lives
// in one place, web/src/data/content.ts, and is free to move without this
// file going stale alongside it.
// preorderConfirmationEmail is the receipt sent once an order first turns paid.
func preorderConfirmationEmail(planDisplayName string, order ddb.Order) mail.Message {
	balance := order.Full - order.DueToday
	subject := fmt.Sprintf("Order confirmed — %s · %s", planDisplayName, order.Reference)

	text := fmt.Sprintf(
		"Your Lyzn is locked in.\n\n"+
			"Reserved. Your place in Batch 01 is held.\n\n"+
			"Your %s preorder is confirmed.\n"+
			"Reference: %s\n\n"+
			"Paid today: %s\n"+
			"Balance on dispatch: %s\n\n"+
			"What happens next\n\n"+
			"1. We build your unit\n"+
			"Manufacturing starts in January. Real time, no vaporware.\n\n"+
			"2. Pre-ship notification\n"+
			"48 hours before we hand it off. You'll get tracking then.\n\n"+
			"3. It arrives. You talk to it.\n"+
			"Pendant listens. You get receipts. No laptop required.\n\n"+
			"We'll email you again before the balance is due.\n"+
			"Questions any time: help@lyzn.ai\n\n"+
			"LYZN\n"+
			"You say, it's done.\n\n"+
			"Lyzn AI · Hyderabad, India\n"+
			"© 2027 Lyzn. All rights reserved.",
		planDisplayName,
		order.Reference,
		formatRupees(order.DueToday),
		formatRupees(balance),
	)

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
	<meta name="x-apple-disable-message-reformatting">

	<style>
		body {
			margin: 0;
			padding: 0;
			background-color: #f0f1f5;
			-webkit-text-size-adjust: 100%%;
			text-size-adjust: 100%%;
		}

		table {
			border-collapse: collapse;
			border-spacing: 0;
			mso-table-lspace: 0;
			mso-table-rspace: 0;
		}

		img {
			border: 0;
			display: block;
		}

		a {
			color: inherit;
		}

		.container {
			width: 600px;
			max-width: 600px;
			background-color: #ffffff;
		}

		.px {
			padding-left: 24px;
			padding-right: 24px;
		}

		.label {
			font-family: Arial, Helvetica, sans-serif;
			font-size: 12px;
			letter-spacing: 0.08em;
			color: #6b6b6b;
			font-weight: 700;
		}

		.headline {
			font-family: Arial, Helvetica, sans-serif;
			font-size: 52px;
			line-height: 1.02;
			letter-spacing: -0.045em;
			font-weight: 700;
			color: #0d0d0d;
		}

		.body {
			font-size: 16px;
			line-height: 1.55;
			color: #2a2a2a;
		}

		.card {
			background-color: #f6f6f6;
			border-radius: 14px;
		}

		.divider {
			height: 1px;
			background-color: #d8d8d8;
			line-height: 1px;
			font-size: 1px;
		}

		.footer {
			background-color: #000000;
			color: #ffffff;
		}

		@media only screen and (max-width: 620px) {
			.container {
				width: 100%% !important;
				max-width: 100%% !important;
			}

			.headline {
				font-size: 40px !important;
			}
		}
	</style>
</head>

<body>
<table role="presentation" width="100%%" bgcolor="#f0f1f5">
	<tr>
		<td align="center">

			<table role="presentation" class="container" width="600">

				<!-- HEADER -->
				<tr>
					<td class="px" style="padding-top:22px;padding-bottom:22px;">
						<table role="presentation" width="100%%">
							<tr>
								<td style="
									font-family:Arial,Helvetica,sans-serif;
									font-size:18px;
									font-weight:800;
									letter-spacing:-0.03em;
									color:#0e1b10;
								">
									LYZN
								</td>

								<td align="right" style="
									font-family:Arial,Helvetica,sans-serif;
									font-size:12px;
									font-weight:700;
									letter-spacing:.08em;
									color:#280f91;
								">
									ORDER CONFIRMED
								</td>
							</tr>
						</table>
					</td>
				</tr>

				<!-- HERO -->
				<tr>
					<td class="px" style="padding-top:32px;">
						<div class="headline">
							Your Lyzn is locked in.
						</div>
					</td>
				</tr>

				<tr>
					<td class="px" style="padding-top:18px;padding-bottom:28px;">
						<div style="
							font-family:Georgia,'Times New Roman',serif;
							font-size:16px;
							line-height:1.55;
							color:#2a2a2a;
						">
							Reserved. Your place in Batch 01 is held.<br><br>
							Your <strong>%s</strong> preorder is confirmed.
							We'll email you again before the balance is due.
						</div>
					</td>
				</tr>

				<!-- DIVIDER -->
				<tr>
					<td class="px">
						<div class="divider">&nbsp;</div>
					</td>
				</tr>

				<!-- ORDER DETAILS -->
				<tr>
					<td class="px" style="padding-top:28px;padding-bottom:28px;">
						<table role="presentation" width="100%%" class="card">
							<tr>
								<td style="
									padding:20px 18px;
									font-family:Arial,Helvetica,sans-serif;
								">

									<table role="presentation" width="100%%">

										<tr>
											<td width="38%%" class="label">
												ORDER ID
											</td>
											<td style="
												font-size:16px;
												font-weight:700;
												color:#111111;
											">
												%s
											</td>
										</tr>

										<tr>
											<td colspan="2" height="18"></td>
										</tr>

										<tr>
											<td class="label">
												PLAN
											</td>
											<td style="
												font-size:16px;
												font-weight:700;
												color:#111111;
											">
												%s
											</td>
										</tr>

										<tr>
											<td colspan="2" height="18"></td>
										</tr>

										<tr>
											<td class="label">
												PAID TODAY
											</td>
											<td style="
												font-size:16px;
												font-weight:700;
												color:#111111;
											">
												%s
											</td>
										</tr>

										<tr>
											<td colspan="2" height="18"></td>
										</tr>

										<tr>
											<td class="label">
												BALANCE
											</td>
											<td style="
												font-size:16px;
												font-weight:700;
												color:#111111;
											">
												%s
											</td>
										</tr>

										<tr>
											<td></td>
											<td style="
												padding-top:5px;
												font-size:13px;
												line-height:1.4;
												color:#777777;
											">
												Due on dispatch
											</td>
										</tr>

									</table>

								</td>
							</tr>
						</table>
					</td>
				</tr>

				<!-- DIVIDER -->
				<tr>
					<td class="px">
						<div class="divider">&nbsp;</div>
					</td>
				</tr>

				<!-- WHAT HAPPENS NEXT -->
				<tr>
					<td class="px" style="padding-top:30px;padding-bottom:12px;">
						<div style="
							font-family:Arial,Helvetica,sans-serif;
							font-size:24px;
							font-weight:700;
							letter-spacing:-0.02em;
							color:#111111;
						">
							What happens next
						</div>
					</td>
				</tr>

				<tr>
					<td class="px" style="padding-bottom:30px;">

						<table role="presentation" width="100%%">

							<!-- STEP 1 -->
							<tr>
								<td width="56" valign="top" style="padding:14px 12px 14px 0;">
									<div style="
										font-family:Arial,Helvetica,sans-serif;
										font-size:24px;
										font-weight:800;
										color:#280f91;
									">
										1
									</div>
								</td>

								<td valign="top" style="
									padding:14px 0;
									border-bottom:1px solid #e5e5e5;
								">
									<div style="
										font-family:Arial,Helvetica,sans-serif;
										font-size:17px;
										font-weight:700;
										color:#111111;
									">
										We build your unit
									</div>

									<div style="
										padding-top:5px;
										font-family:Georgia,'Times New Roman',serif;
										font-size:15px;
										line-height:1.5;
										color:#555555;
									">
										Manufacturing starts in soon. Real time, no vaporware.
									</div>
								</td>
							</tr>

							<!-- STEP 2 -->
							<tr>
								<td width="56" valign="top" style="padding:14px 12px 14px 0;">
									<div style="
										font-family:Arial,Helvetica,sans-serif;
										font-size:24px;
										font-weight:800;
										color:#280f91;
									">
										2
									</div>
								</td>

								<td valign="top" style="
									padding:14px 0;
									border-bottom:1px solid #e5e5e5;
								">
									<div style="
										font-family:Arial,Helvetica,sans-serif;
										font-size:17px;
										font-weight:700;
										color:#111111;
									">
										Pre-ship notification
									</div>

									<div style="
										padding-top:5px;
										font-family:Georgia,'Times New Roman',serif;
										font-size:15px;
										line-height:1.5;
										color:#555555;
									">
										48 hours before we hand it off. You'll get tracking then.
									</div>
								</td>
							</tr>

							<!-- STEP 3 -->
							<tr>
								<td width="56" valign="top" style="padding:14px 12px 14px 0;">
									<div style="
										font-family:Arial,Helvetica,sans-serif;
										font-size:24px;
										font-weight:800;
										color:#280f91;
									">
										3
									</div>
								</td>

								<td valign="top" style="padding:14px 0;">
									<div style="
										font-family:Arial,Helvetica,sans-serif;
										font-size:17px;
										font-weight:700;
										color:#111111;
									">
										It arrives. You talk to it.
									</div>

									<div style="
										padding-top:5px;
										font-family:Georgia,'Times New Roman',serif;
										font-size:15px;
										line-height:1.5;
										color:#555555;
									">
										Pendant listens. You get receipts. No laptop required.
									</div>
								</td>
							</tr>

						</table>

					</td>
				</tr>

				<!-- DIVIDER -->
				<tr>
					<td class="px">
						<div class="divider">&nbsp;</div>
					</td>
				</tr>

				<!-- QUESTIONS -->
				<tr>
					<td class="px" style="padding-top:30px;padding-bottom:34px;">

						<div style="
							font-family:Arial,Helvetica,sans-serif;
							font-size:24px;
							font-weight:700;
							letter-spacing:-0.02em;
							color:#111111;
						">
							Questions?
						</div>

						<div style="
							padding-top:12px;
							font-family:Georgia,'Times New Roman',serif;
							font-size:16px;
							line-height:1.55;
							color:#2a2a2a;
						">
							Hit reply to this email. We read everything.
						</div>

						<div style="
							padding-top:8px;
							font-family:Georgia,'Times New Roman',serif;
							font-size:16px;
							line-height:1.55;
							color:#2a2a2a;
						">
							Or check the FAQ at
							<a
								href="https://lyzn.ai/#faq"
								style="
									color:#280f91;
									font-weight:700;
									text-decoration:underline;
								"
							>
								lyzn.ai/faq
							</a>
						</div>

						<div style="
							padding-top:8px;
							font-family:Georgia,'Times New Roman',serif;
							font-size:16px;
							line-height:1.55;
							color:#2a2a2a;
						">
							Questions any time:
							<a
								href="mailto:help@lyzn.ai"
								style="
									color:#280f91;
									font-weight:700;
									text-decoration:underline;
								"
							>
								help@lyzn.ai
							</a>
						</div>

					</td>
				</tr>

				<!-- BRAND SIGN-OFF -->
				<tr>
					<td class="px" style="padding-bottom:26px;">
						<table role="presentation" width="100%%"
							style="border-top:1px solid #d8d8d8;">
							<tr>
								<td style="
									padding-top:18px;
									font-family:Arial,Helvetica,sans-serif;
									font-size:18px;
									font-weight:800;
									color:#111111;
								">
									LYZN
								</td>

								<td align="right" style="
									padding-top:18px;
									font-family:Arial,Helvetica,sans-serif;
									font-size:16px;
									font-weight:700;
									color:#280f91;
								">
									You say, it's done.
								</td>
							</tr>
						</table>
					</td>
				</tr>

				<!-- FOOTER -->
				<tr>
					<td class="footer"
						style="
							padding:22px 24px;
							text-align:center;
							font-family:Arial,Helvetica,sans-serif;
						">

						<div style="
							font-size:13px;
							line-height:1.7;
							color:#ffffff;
						">
							Lyzn AI · Hyderabad, India
						</div>

						<div style="
							font-size:13px;
							line-height:1.7;
							color:#ffffff;
						">
							© 2026 Lyzn. All rights reserved.
						</div>

					</td>
				</tr>

			</table>

		</td>
	</tr>
</table>
</body>
</html>`,
		planDisplayName,
		order.Reference,
		planDisplayName,
		formatRupees(order.DueToday),
		formatRupees(balance),
	)

	return mail.Message{
		To:      order.Contact.Email,
		Subject: subject,
		Text:    text,
		HTML:    html,
	}
}

// sendPreorderConfirmation is best-effort and logged only: by the time this
// runs the payment is real and the order is already marked paid, so an SES
// blip is not worth failing the request or the webhook over. Callers only
// reach this once per order — see the justPaid gate at each call site.
func sendPreorderConfirmation(ctx context.Context, order ddb.Order) {
	if order.Contact.Email == "" {
		return
	}
	msg := preorderConfirmationEmail(planName(ctx, order.Plan), order)
	if err := mail.Send(ctx, msg); err != nil {
		log.Printf("orders: confirmation email for %s: %v", order.Reference, err)
	}
}
