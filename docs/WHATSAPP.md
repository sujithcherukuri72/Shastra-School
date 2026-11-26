# WhatsApp setup (Meta WhatsApp Business Cloud API)

In development, `WHATSAPP_PROVIDER=console` prints every message, including login codes, to the API log.
For real delivery, switch to `meta`.

## 1. One-time setup in Meta

1. Create a **Meta Business** account, then create an app with the **WhatsApp** product at developers.facebook.com.
2. Add and verify the school's WhatsApp number. Note its **Phone number ID**.
3. Create a **System User** with a **permanent access token** that has the `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions.
4. Note the app's **App Secret** (App settings → Basic). It is used to verify webhooks.
5. Choose any long random **verify token** of your own.

```env
WHATSAPP_PROVIDER=meta
WHATSAPP_API_VERSION=v23.0          # use the current Graph API version shown in Meta's dashboard
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_APP_SECRET=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_TEMPLATE_LANG=en
```

## 2. Webhook (delivery and read ticks)

- **Callback URL:** `https://YOUR_DOMAIN/api/webhooks/whatsapp`
- **Verify token:** the same value as `WHATSAPP_VERIFY_TOKEN`
- **Subscribe to:** `messages`

Every callback is checked against `X-Hub-Signature-256`. Unsigned or wrongly signed calls are rejected.

## 3. Message templates (create these in WhatsApp Manager)

The names and the number of variables must match exactly. Meta usually approves *Utility* templates within minutes.

| Name | Category | Header | Body |
| --- | --- | --- | --- |
| `absence_alert` | Utility | – | Dear Parent, {{1}} was marked absent today ({{2}}). If this is unexpected, please contact the school. – {{3}} |
| `fee_reminder` | Utility | – | Dear Parent, a fee of Rs. {{2}} for {{1}} is due on {{3}}. You can pay in the Shastra Connect app. – {{4}} |
| `monthly_report` | Utility | **Document** | Dear Parent, the progress report of {{1}} for {{2}} is attached. – {{3}} |
| `school_notice` | Utility | – | Notice: {{1}} … {{2}} … – {{3}} |
| `birthday_wish` | Marketing* | – | Happy Birthday, {{1}}! 🎂 {{2}} With love, {{3}}. |
| `payment_receipt` | Utility | – | Payment received: Rs. {{2}} for {{1}}. Receipt no. {{3}}. Thank you! – {{4}} |
| `login_otp` | **Authentication** | – | Use Meta's authentication template with a *copy code* button. {{1}} is the code. |

\* Meta may classify birthday wishes as Marketing. Marketing messages need the parent's opt-in.
The `guardians.whatsapp_opt_in` flag controls who receives any WhatsApp message at all.

## How sending works

Messages are never sent inline. The API writes them to the `wa_messages` **outbox** in the same database transaction
as the change that caused them. The **worker** then sends them:
- It retries with backoff: 30 s, 60 s, 120 s and so on, up to 5 attempts.
- Each message has a `dedupe_key` that guarantees it goes out once, for example
  `absence:<student>:<date>:<parent>` or `birthday:<student>:<date>`.
- Failed messages appear in **WhatsApp log** with the error and a *Retry* button.
