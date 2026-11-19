import { ImapFlow } from "imapflow";

export function imapConfigured() {
  return Boolean(process.env.LOG_APPLY_IMAP_USER && process.env.LOG_APPLY_IMAP_PASS);
}

function textOf(source) {
  const raw = source.toString("utf8");
  const decoded = raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return decoded.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
}

export async function searchMail(query, pattern, minutes = 30) {
  if (!imapConfigured()) throw new Error("mailNotConfigured: set LOG_APPLY_IMAP_USER and LOG_APPLY_IMAP_PASS (a Gmail app password) for the chrome driver");
  const client = new ImapFlow({ host: process.env.LOG_APPLY_IMAP_HOST || "imap.gmail.com", port: 993, secure: true, auth: { user: process.env.LOG_APPLY_IMAP_USER, pass: process.env.LOG_APPLY_IMAP_PASS }, logger: false });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const since = new Date(Date.now() - minutes * 60_000);
    const gmail = /gmail\.com$/i.test(process.env.LOG_APPLY_IMAP_HOST || "imap.gmail.com");
    const uids = gmail ? await client.search({ gmailRaw: `${query} newer_than:${Math.max(1, Math.ceil(minutes / 60))}h`, since }) : await client.search({ since, body: query });
    const re = new RegExp(pattern, "i");
    for (const uid of (uids || []).slice(-10).reverse()) {
      const msg = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
      if (!msg || msg.internalDate < since) continue;
      const m = textOf(msg.source).match(re);
      if (m) return m[1] || m[0];
    }
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}
