// Guest emails through EmailJS (emailjs.com), called from this server with the
// account's private key ("Allow EmailJS API for non-browser applications" must
// be on in EmailJS → Account → Security). The EmailJS template only places the
// values sent here — see NOTIFICATIONS_SETUP.md for its exact setup:
//   To: {{to_email}}  Subject: {{subject}}  Reply-to: {{reply_to}}
//   Content (HTML): {{{message_html}}}

import type { Config } from '../config.ts';

type EmailJsCfg = Config['notify']['emailjs'];

export const emailJsConfigured = (cfg: EmailJsCfg) => Boolean(cfg.serviceId && cfg.templateId && cfg.publicKey && cfg.privateKey);

export async function sendViaEmailJs(cfg: EmailJsCfg, email: { to: string; subject: string; text: string; html: string; replyTo: string }): Promise<void> {
  if (!emailJsConfigured(cfg)) throw new Error('EmailJS is not configured (EMAILJS_SERVICE_ID / TEMPLATE_ID / PUBLIC_KEY / PRIVATE_KEY)');
  const res = await fetch(cfg.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: cfg.serviceId,
      template_id: cfg.templateId,
      user_id: cfg.publicKey,
      accessToken: cfg.privateKey,
      template_params: {
        to_email: email.to,
        subject: email.subject,
        reply_to: email.replyTo,
        message_html: email.html,
        message_text: email.text,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  // EmailJS answers 200 "OK" when it has accepted the email; anything else is an error message.
  const body = (await res.text()).trim().slice(0, 200);
  if (!res.ok) throw new Error(`EmailJS refused the email (HTTP ${res.status}): ${body || 'no details'}`);
}
