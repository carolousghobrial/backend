/**
 * Deacons School re-enrollment reminder — for last year's members who
 * haven't yet registered for the new year. Table-based layout + inline
 * styles throughout (Outlook/Gmail don't reliably support <style> blocks).
 */

const MAROON = "#8b181d";
const INK = "#2c2c2c";
const MUTED = "#6b6b6b";
const CREAM = "#faf9f4";
const LINE = "#e6e2d8";
const LOGO_URL = "https://www.stgeorgecocnashville.org/assets/Images/ChurchLogo.png";
const FEE = 25;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * @param {object} p
 * @param {string} p.firstName
 * @param {string} p.lastYearClassName - class they were in last year
 * @param {string} p.nextClassName - the resolved class to register into
 * @param {boolean} p.promoted - true = moving up, false = continuing the same level
 * @param {string} p.upcomingYear - e.g. "2026-2027"
 * @param {string} p.magicLink - one-click sign-in + register URL
 */
function renderReenrollmentEmail({
  firstName,
  lastYearClassName,
  nextClassName,
  promoted,
  upcomingYear,
  magicLink,
}) {
  const name = escapeHtml(firstName);
  const lastClass = escapeHtml(lastYearClassName);
  const nextClass = escapeHtml(nextClassName);
  const year = escapeHtml(upcomingYear);
  const link = escapeHtml(magicLink);

  const subject = `${firstName}, it's time to register for Deacons School ${upcomingYear}`;

  // Only announce a specific class when it's good news (moving up). For a
  // repeat year, keep it a general "time to register" nudge — no class name.
  const progressLine = promoted
    ? `Since ${lastClass}, ${name} is ready to move up to <strong>${nextClass}</strong> this year.`
    : `Registration for the new Deacons School year is now open.`;

  const preheader = `Registration is open for ${upcomingYear} — sign in to secure ${name}'s spot.`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:28px 24px 16px;">
              <img src="${LOGO_URL}" alt="St. George Coptic Orthodox Church" width="64" height="64" style="display:block;border-radius:8px;">
              <div style="margin-top:10px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};">
                St. George Coptic Orthodox Church
              </div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:4px 32px 0;">
              <h1 style="margin:0 0 4px;font-size:22px;line-height:1.3;color:${MAROON};">
                Deacons School Registration is Open
              </h1>
              <p style="margin:0;font-size:13px;color:${MUTED};">${year} Academic Year</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 32px 0;font-size:16px;line-height:1.6;color:${INK};">
              <p style="margin:0 0 14px;">Dear ${name}'s family,</p>
              <p style="margin:0 0 14px;">${progressLine}</p>
              <p style="margin:0 0 14px;">
                We haven't seen a registration for ${name} yet this year — click below to sign in
                and complete it. It only takes a couple of minutes.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:22px 32px 6px;">
              <a href="${link}" target="_blank"
                style="display:inline-block;background:${MAROON};color:#ffffff;text-decoration:none;
                       font-size:16px;font-weight:bold;padding:14px 32px;border-radius:10px;">
                Sign In &amp; Register
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 6px;font-size:13px;color:${MUTED};">
              This link signs ${name} in automatically — no password needed.
            </td>
          </tr>

          <!-- Fee note -->
          <tr>
            <td style="padding:18px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="background:${CREAM};border:1px dashed ${LINE};border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;font-size:14px;color:${INK};">
                    A one-time <strong>$${FEE}.00</strong> registration fee is collected online
                    when you complete the form. If that's a hardship, please contact the church
                    office — we don't want cost to be the reason a student misses a year.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:24px 32px 0;"><hr style="border:none;border-top:1px solid ${LINE};margin:0;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 28px;font-size:12px;line-height:1.6;color:${MUTED};">
              <p style="margin:0 0 6px;">
                Having trouble with the button, or already registered? Reply to this email or
                contact the church office and we'll help directly.
              </p>
              <p style="margin:0;">
                St. George Coptic Orthodox Church · 2412 Foster Avenue, Nashville, TN
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Dear ${firstName}'s family,

${progressLine.replace(/<\/?strong>/g, "")}

We haven't seen a registration for ${firstName} yet this year — sign in and complete it here:
${magicLink}

A one-time $${FEE}.00 registration fee is collected online when you complete the form. If that's a hardship, please contact the church office.

St. George Coptic Orthodox Church
2412 Foster Avenue, Nashville, TN`;

  return { subject, html, text };
}

module.exports = { renderReenrollmentEmail };
