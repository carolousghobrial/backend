/**
 * Shared transactional-email sender for live route handlers (as opposed to
 * the one-off campaign scripts under scripts/, which have their own copy of
 * this same call). Posts to the send-campaign-email Supabase edge function,
 * which is backed by Resend and requires the service-role key as its bearer
 * token (see supabase/functions/send-campaign-email/index.ts).
 */

const EDGE_FUNCTION_URL =
  "https://oplzcugljytvywvewdkj.supabase.co/functions/v1/send-campaign-email";

const DEFAULT_FROM = "St. George Deacons School <noreply@stgeorgecocnashville.org>";
const DEFAULT_REPLY_TO = "st.georgedeaconschool@gmail.com";

/**
 * @param {Array<{to: string, subject: string, html: string, text?: string}>} emails
 * @param {{from?: string, replyTo?: string}} [opts]
 * @returns {Promise<{ok: boolean, status: number, body: any}>}
 */
async function sendEmails(emails, opts = {}) {
  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from || DEFAULT_FROM,
      replyTo: opts.replyTo || DEFAULT_REPLY_TO,
      emails,
    }),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

module.exports = { sendEmails, DEFAULT_FROM, DEFAULT_REPLY_TO };
