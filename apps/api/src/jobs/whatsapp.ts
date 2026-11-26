import { env } from '../config/env.ts';
import { logger, maskPhone } from '../lib/logger.ts';

/**
 * WhatsApp Business templates. Each must be created and approved in Meta Business Manager
 * with exactly these names and the same number of {{n}} body variables (see docs/WHATSAPP.md).
 */
export const TEMPLATES = {
  absence_alert: { vars: 3, text: 'Dear Parent, {{1}} was marked absent today ({{2}}). If this is unexpected, please contact the school. – {{3}}' },
  fee_reminder: { vars: 4, text: 'Dear Parent, a fee of Rs. {{2}} for {{1}} is due on {{3}}. You can pay in the Shastra Connect app. – {{4}}' },
  monthly_report: { vars: 3, text: 'Dear Parent, the progress report of {{1}} for {{2}} is attached. – {{3}}', document: true },
  school_notice: { vars: 3, text: 'Notice: {{1}}\n\n{{2}}\n\n– {{3}}' },
  birthday_wish: { vars: 3, text: 'Happy Birthday, {{1}}! 🎂 {{2}} With love, {{3}}.' },
  payment_receipt: { vars: 4, text: 'Payment received: Rs. {{2}} for {{1}}. Receipt no. {{3}}. Thank you! – {{4}}' },
  login_otp: { vars: 1, text: '{{1}} is your Shastra Connect login code. It expires in 5 minutes. Do not share it with anyone.' },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

export function renderPreview(template: TemplateName, params: string[]) {
  return TEMPLATES[template].text.replace(/\{\{(\d)\}\}/g, (_m, n) => params[Number(n) - 1] ?? '');
}

export interface SendInput {
  to: string;
  template: TemplateName;
  lang: string;
  params: string[];
  document?: { buffer: Buffer; filename: string; mime: string };
}
export interface SendResult {
  providerMessageId: string;
  status: 'sent' | 'delivered';
}

interface Provider {
  send(m: SendInput): Promise<SendResult>;
}

/** Development provider: prints the message instead of sending it. */
const consoleProvider: Provider = {
  async send(m) {
    const isOtp = m.template === 'login_otp';
    logger.info(
      { to: maskPhone(m.to), template: m.template, ...(m.document ? { attachment: m.document.filename } : {}) },
      `[whatsapp:console] ${isOtp && env.NODE_ENV !== 'production' ? `OTP for ${m.to}: ${m.params[0]}` : renderPreview(m.template, m.params)}`,
    );
    return { providerMessageId: `console.${crypto.randomUUID()}`, status: 'delivered' };
  },
};

const graph = (p: string) => `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${p}`;

async function metaFetch(url: string, init: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err = new Error(body?.error?.message ?? `WhatsApp API HTTP ${res.status}`) as Error & { retryable?: boolean };
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  return body;
}

/** WhatsApp Business Cloud API provider. */
const metaProvider: Provider = {
  async send(m) {
    const components: any[] = [];
    if (m.document) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', m.document.mime);
      form.append('file', new Blob([new Uint8Array(m.document.buffer)], { type: m.document.mime }), m.document.filename);
      const media = await metaFetch(graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/media`), { method: 'POST', body: form });
      components.push({ type: 'header', parameters: [{ type: 'document', document: { id: media.id, filename: m.document.filename } }] });
    }
    components.push({ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text: text.slice(0, 1000) })) });
    if (m.template === 'login_otp') {
      // Authentication templates carry a copy-code button that repeats the code.
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.params[0] }] });
    }
    const body = await metaFetch(graph(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: m.to.replace(/^\+/, ''),
        type: 'template',
        template: { name: m.template, language: { code: m.lang }, components },
      }),
    });
    const id = body?.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp API returned no message id');
    return { providerMessageId: id, status: 'sent' };
  },
};

export const whatsapp: Provider = env.WHATSAPP_PROVIDER === 'meta' ? metaProvider : consoleProvider;
