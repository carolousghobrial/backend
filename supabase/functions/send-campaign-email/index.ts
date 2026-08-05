// Generic transactional/bulk email sender, backed by Resend.
//
// Deliberately content-agnostic: callers pass fully-rendered HTML, this
// function's only job is delivery. Reusable for any future campaign, not
// tied to Deacons School.
//
// Auth: Supabase verifies the caller's JWT by default before this code runs.
// We additionally require the `service_role` claim so only trusted backend
// code (using the service-role key as the bearer token) can send email
// through here — never an end-user session.
//
// Request body:
//   {
//     emails: Array<{ to: string; subject: string; html: string; text?: string }>,
//     from: string,          // e.g. "St. George Deacons School <noreply@yourdomain.org>"
//     replyTo?: string,
//   }
//
// Response:
//   { success: true, sent: number, batches: number, results: Array<{...}> }
//   or { success: false, error: string } on a request-shape problem.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_BATCH_LIMIT = 100; // Resend's per-request cap

interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/** Decode (not verify — Supabase's gateway already verified the signature)
 *  the JWT payload to check the role claim. */
function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const role = decodeJwtRole(req.headers.get("Authorization"));
  if (role !== "service_role") {
    return json(
      { success: false, error: "Forbidden — service role required" },
      403,
    );
  }

  if (!RESEND_API_KEY) {
    return json(
      { success: false, error: "RESEND_API_KEY is not configured" },
      500,
    );
  }

  let body: { emails?: EmailInput[]; from?: string; replyTo?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { emails, from, replyTo } = body;
  if (!from || typeof from !== "string") {
    return json({ success: false, error: '"from" is required' }, 400);
  }
  if (!Array.isArray(emails) || emails.length === 0) {
    return json({ success: false, error: '"emails" must be a non-empty array' }, 400);
  }
  for (const [i, e] of emails.entries()) {
    if (!e.to || !e.subject || !e.html) {
      return json(
        { success: false, error: `emails[${i}] is missing to/subject/html` },
        400,
      );
    }
  }

  const batches = chunk(emails, RESEND_BATCH_LIMIT);
  const results: unknown[] = [];
  let sent = 0;

  for (const batch of batches) {
    const payload = batch.map((e) => ({
      from,
      to: [e.to],
      subject: e.subject,
      html: e.html,
      text: e.text,
      reply_to: replyTo,
    }));

    const res = await fetch(RESEND_BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const resBody = await res.json().catch(() => null);
    results.push({ status: res.status, ok: res.ok, body: resBody });

    if (res.ok) {
      // Resend's batch response is { data: [{ id }, ...] } in send order.
      sent += Array.isArray(resBody?.data) ? resBody.data.length : batch.length;
    }
  }

  return json({ success: true, sent, batches: batches.length, results });
});
