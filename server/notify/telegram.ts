// Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
// The bot token stays on the server (TELEGRAM_BOT_TOKEN) and never reaches the browser.

import type { Config } from '../config.ts';

type TelegramCfg = Config['notify'];

/** Escapes text for Telegram's HTML parse mode (only &, < and > are special). */
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const telegramConfigured = (cfg: TelegramCfg) => Boolean(cfg.telegramBotToken && cfg.telegramChatId);

type SendInput = {
  /** HTML message; all user input inside it must already be escaped. */
  html: string;
  /** Same message without links, used if Telegram rejects the HTML (e.g. a link scheme it doesn't accept). */
  fallbackHtml?: string;
  /** Optional inline buttons (https URLs only — Telegram rejects tel: in buttons). */
  buttons?: { text: string; url: string }[];
};

export async function sendTelegram(cfg: TelegramCfg, nodeEnv: string, input: SendInput): Promise<void> {
  if (!telegramConfigured(cfg)) throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  if (cfg.telegramApiBase && nodeEnv === 'production') throw new Error('Telegram API override is test-only');
  const base = cfg.telegramApiBase ?? 'https://api.telegram.org';
  const url = `${base}/bot${cfg.telegramBotToken}/sendMessage`;

  const post = async (text: string) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.telegramChatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(input.buttons?.length ? { reply_markup: { inline_keyboard: [input.buttons] } } : {}),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return { ok: res.ok && json.ok === true, status: res.status, description: json.description ?? '' };
  };

  let r = await post(input.html);
  // 400 = Telegram couldn't accept the formatting; retry once with the plain version.
  if (!r.ok && r.status === 400 && input.fallbackHtml) r = await post(input.fallbackHtml);
  // Never include the URL (it contains the bot token) in errors or logs.
  if (!r.ok) throw new Error(`Telegram sendMessage failed (${r.status}): ${r.description}`);
}
