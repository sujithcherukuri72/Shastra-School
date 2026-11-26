import express, { Router } from 'express';
import { env } from '../config/env.ts';
import { applyDeliveryStatus } from '../jobs/outbox.ts';
import { logger } from '../lib/logger.ts';
import { hmacHex, safeEqual } from '../security/crypto.ts';
import { razorpayWebhook } from './fees.ts';

/**
 * Server-to-server callbacks. They carry no cookies, so they skip session + CSRF handling
 * and are authenticated by verifying the provider's HMAC signature over the raw body.
 */
const r = Router();
const raw = express.raw({ type: 'application/json', limit: '1mb' });
const keepRaw: express.RequestHandler = (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBody = req.body;
  next();
};

r.post('/razorpay', raw, keepRaw, razorpayWebhook);

// Meta subscription handshake.
r.get('/whatsapp', (req, res) => {
  const ok =
    env.WHATSAPP_VERIFY_TOKEN &&
    req.query['hub.mode'] === 'subscribe' &&
    typeof req.query['hub.verify_token'] === 'string' &&
    safeEqual(req.query['hub.verify_token'], env.WHATSAPP_VERIFY_TOKEN);
  if (!ok) return void res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
});

// Delivery / read receipts.
r.post('/whatsapp', raw, keepRaw, async (req, res) => {
  const sig = (req.get('x-hub-signature-256') ?? '').replace(/^sha256=/, '');
  if (!env.WHATSAPP_APP_SECRET || !req.rawBody || !safeEqual(hmacHex(env.WHATSAPP_APP_SECRET, req.rawBody), sig)) {
    logger.warn({ ip: req.ip }, 'Rejected WhatsApp webhook with bad signature');
    return void res.sendStatus(401);
  }
  const body = JSON.parse(req.rawBody.toString('utf8'));
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        if (typeof s?.id === 'string' && typeof s?.status === 'string') {
          await applyDeliveryStatus(s.id, s.status, s.errors?.[0]?.title);
        }
      }
    }
  }
  res.sendStatus(200);
});

export default r;
