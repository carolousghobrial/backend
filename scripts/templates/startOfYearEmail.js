/**
 * Deacons School "classes start this week" announcement — sent to everyone
 * with an active enrollment in the current academic year. Table-based layout
 * + inline styles throughout (Outlook/Gmail don't reliably support <style>
 * blocks), matching the house style used in reenrollmentEmail.js.
 */

const MAROON = "#8b181d";
const INK = "#2c2c2c";
const MUTED = "#6b6b6b";
const CREAM = "#faf9f4";
const LINE = "#e6e2d8";
const LOGO_URL = "https://www.stgeorgecocnashville.org/assets/Images/ChurchLogo.png";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * @param {object} p
 * @param {string} p.firstName
 * @param {string} p.className - the student's class, e.g. "Level 3"
 * @param {string} p.academicYear - e.g. "2026-2027"
 * @param {string} p.magicLink - one-click sign-in URL (no password needed)
 * @param {string} p.calendarLink - public link to this class's schedule
 */
function renderStartOfYearEmail({
  firstName,
  className,
  academicYear,
  magicLink,
  calendarLink,
}) {
  const name = escapeHtml(firstName);
  const cls = escapeHtml(className);
  const year = escapeHtml(academicYear);
  const signInLink = escapeHtml(magicLink);
  const scheduleLink = escapeHtml(calendarLink);

  const subject = `Deacons School starts this week — ${className}`;
  const preheader = `${className} begins this week. Sign in to the portal and check the schedule.`;

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
                Deacons School Starts This Week!
              </h1>
              <p style="margin:0;font-size:13px;color:${MUTED};">${year} Academic Year · ${cls}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 32px 0;font-size:16px;line-height:1.6;color:${INK};">
              <p style="margin:0 0 14px;">Dear ${name}'s family,</p>
              <p style="margin:0 0 14px;">
                We're excited to let you know that Deacons School classes begin this week for
                <strong>${cls}</strong>. We can't wait to see ${name} there!
              </p>
              <p style="margin:0 0 14px;">
                Sign in to the parent portal below to keep up with attendance and grades, and check
                ${name}'s full class schedule for the year.
              </p>
            </td>
          </tr>

          <!-- CTA: sign in -->
          <tr>
            <td align="center" style="padding:22px 32px 6px;">
              <a href="${signInLink}" target="_blank"
                style="display:inline-block;background:${MAROON};color:#ffffff;text-decoration:none;
                       font-size:16px;font-weight:bold;padding:14px 32px;border-radius:10px;">
                Sign In to the Portal
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 6px;font-size:13px;color:${MUTED};">
              This link signs ${name}'s family in automatically — no password needed.
            </td>
          </tr>

          <!-- CTA: schedule -->
          <tr>
            <td align="center" style="padding:14px 32px 6px;">
              <a href="${scheduleLink}" target="_blank"
                style="display:inline-block;background:${CREAM};color:${MAROON};text-decoration:none;
                       border:1px solid ${MAROON};font-size:15px;font-weight:bold;padding:12px 28px;border-radius:10px;">
                View ${cls} Schedule
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 6px;font-size:13px;color:${MUTED};">
              No sign-in required to view the schedule.
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:24px 32px 0;"><hr style="border:none;border-top:1px solid ${LINE};margin:0;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 28px;font-size:12px;line-height:1.6;color:${MUTED};">
              <p style="margin:0 0 6px;">
                Questions? Reply to this email or contact the church office and we'll help directly.
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

We're excited to let you know that Deacons School classes begin this week for ${className}. We can't wait to see ${firstName} there!

Sign in to the parent portal (no password needed):
${magicLink}

View ${className}'s full schedule (no sign-in required):
${calendarLink}

St. George Coptic Orthodox Church
2412 Foster Avenue, Nashville, TN`;

  return { subject, html, text };
}

module.exports = { renderStartOfYearEmail };
