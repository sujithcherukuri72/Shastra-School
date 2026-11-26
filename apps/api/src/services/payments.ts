import { env } from '../config/env.ts';
import { hmacHex, randomToken, safeEqual } from '../security/crypto.ts';

export interface Order {
  orderId: string;
  amountPaise: number;
}

interface PaymentProvider {
  name: 'mock' | 'razorpay';
  publicKey: string | null;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<Order>;
  /** Signature returned to the browser by the checkout widget. */
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  /** Signature on server-to-server webhooks. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

const razorpay: PaymentProvider = {
  name: 'razorpay',
  publicKey: env.RAZORPAY_KEY_ID || null,
  async createOrder(amountPaise, receipt, notes) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !body.id) throw new Error(body?.error?.description ?? 'Could not create payment order');
    return { orderId: body.id, amountPaise: body.amount };
  },
  verifyCheckout(orderId, paymentId, signature) {
    return safeEqual(hmacHex(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature);
  },
  verifyWebhook(rawBody, signature) {
    return safeEqual(hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);
  },
};

/** Development-only gateway. Refused in production by env validation. */
const mock: PaymentProvider = {
  name: 'mock',
  publicKey: null,
  async createOrder(amountPaise) {
    return { orderId: `mock_order_${randomToken(12)}`, amountPaise };
  },
  verifyCheckout: () => true,
  verifyWebhook: () => false,
};

export const paymentProvider: PaymentProvider = env.PAYMENT_PROVIDER === 'razorpay' ? razorpay : mock;
