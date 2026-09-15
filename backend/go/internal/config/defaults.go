// The application configuration this backend ships with.
//
// Prices, the tier copy, the feature flags and the notification schedule are
// remote configuration: the app and the website read them from GET /config
// and an administrator changes them with PUT /admin/config, without a
// deploy. What follows is the shape those two agree on and the values a
// fresh table is seeded with — the tiers exactly as lyzn.ai sells them
// today, so switching the website over to the API changes no price and no
// sentence.
//
// It lives here, beside the rest of what this backend reads from outside
// itself, and it lives as JSON rather than as a Go literal for one reason:
// the type belongs to internal/ddb, which reads this package, and a typed
// default here would make the two import each other. JSON is also what an
// administrator sends, so the seed and an update are the same document, and
// backend/scripts/config.md can quote this file verbatim.
//
// Amounts are paise, everywhere, and must be whole rupees — the checkout
// charges rupees × 100, so a stray fifty paise would be silently dropped.
// internal/ddb's Validate refuses anything else.
package config

// DefaultAppConfigJSON is the configuration a table with no CONFIG row is
// seeded with, and the fallback served when DynamoDB cannot be reached.
//
// The tier `lines` are the website's own bullets (web/src/data/pricing.ts),
// the chooser copy is its pricing section's heading and standfirst
// (web/src/data/content.ts), and `indiaOnly` is the note printed under the
// phone field. `receiptTitle` is the canvas' receipt header.
//
// `version` starts at 1 and PUT /admin/config bumps it; `updatedAt` is
// stamped when the row is written, so it is empty here.
const DefaultAppConfigJSON = `{
  "version": 1,
  "updatedAt": "",
  "pricing": {
    "currency": "INR",
    "preorder": true,
    "tiers": [
      {
        "id": "capture",
        "name": "Capture",
        "full": 599900,
        "deposit": 99900,
        "monthly": 0,
        "enabled": true,
        "badge": "",
        "lines": [
          "Unlimited recording and transcription",
          "Every commitment you made, listed",
          "Runs on your phone — no laptop needed",
          "No subscription. Ever."
        ]
      },
      {
        "id": "act",
        "name": "Act",
        "full": 899900,
        "deposit": 99900,
        "monthly": 0,
        "enabled": true,
        "badge": "Most chosen",
        "lines": [
          "Everything in Capture",
          "Orchestrator for your laptop",
          "Tasks get done, not just listed",
          "Bring your own Claude or ChatGPT subscription",
          "No subscription to us. Ever."
        ]
      },
      {
        "id": "act-pro",
        "name": "Act Pro",
        "full": 1299900,
        "deposit": 99900,
        "monthly": 49900,
        "enabled": true,
        "badge": "",
        "lines": [
          "Everything in Act",
          "No ChatGPT or Claude account, nothing to configure",
          "We supply the AI — ₹499 a month from activation",
          "Or bring your own key and pay nothing"
        ]
      }
    ],
    "copy": {
      "chooserTitle": "What it costs",
      "chooserSub": "Three ways to buy it. The device is the same in all three — what changes is how much work it does for you.",
      "depositNote": "Balance on dispatch · November 2026",
      "indiaOnly": "Indian mobile numbers only — LYZN ships in India for now.",
      "receiptTitle": "LYZN · PROOF OF WORK"
    }
  },
  "features": {
    "daemon": false,
    "whatsapp": false,
    "execution": false,
    "askLyzn": true,
    "phoneCapture": true,
    "darkMode": true
  },
  "notifications": {
    "digestHour": 8
  }
}`
