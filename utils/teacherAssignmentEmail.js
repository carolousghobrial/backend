/**
 * "You've been assigned to teach" notification — sent when a coordinator
 * assigns a teacher to a specific week's class on the Teacher Schedule page
 * (ds_calendar_teacher_assignments). Table-based layout + inline styles
 * throughout (Outlook/Gmail don't reliably support <style> blocks), matching
 * scripts/templates/reenrollmentEmail.js.
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

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/**
 * @param {object} p
 * @param {string} p.firstName
 * @param {string} p.className - e.g. "Deacons School Level 3"
 * @param {string} p.role - "Hymn" | "Other" (rituals/memorization/altar/coptic)
 * @param {string} p.calendarDay - ISO date (yyyy-mm-dd) of the class
 * @param {string} [p.scheduleUrl] - link to the login/schedule page
 */
function renderTeacherAssignmentEmail({ firstName, className, role, calendarDay, scheduleUrl }) {
  const name = escapeHtml(firstName);
  const cls = escapeHtml(className);
  const roleLabel = escapeHtml(role);
  const dateLabel = escapeHtml(formatDate(calendarDay));
  const link = escapeHtml(scheduleUrl || "https://www.stgeorgecocnashville.org/login");

  const subject = `You're teaching ${className} on ${formatDate(calendarDay)}`;
  const preheader = `${roleLabel} assignment for ${cls} — ${dateLabel}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

          <tr>
            <td align="center" style="padding:28px 24px 16px;">
              <img src="${LOGO_URL}" alt="St. George Coptic Orthodox Church" width="64" height="64" style="display:block;border-radius:8px;">
              <div style="margin-top:10px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};">
                St. George Coptic Orthodox Church
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:4px 32px 0;">
              <h1 style="margin:0 0 4px;font-size:22px;line-height:1.3;color:${MAROON};">
                New Teaching Assignment
              </h1>
              <p style="margin:0;font-size:13px;color:${MUTED};">Deacons School</p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 0;font-size:16px;line-height:1.6;color:${INK};">
              <p style="margin:0 0 14px;">Hi ${name},</p>
              <p style="margin:0 0 14px;">
                You've been assigned to teach <strong>${roleLabel}</strong> for
                <strong>${cls}</strong> on <strong>${dateLabel}</strong>.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 32px 6px;">
              <a href="${link}" target="_blank"
                style="display:inline-block;background:${MAROON};color:#ffffff;text-decoration:none;
                       font-size:16px;font-weight:bold;padding:14px 32px;border-radius:10px;">
                View My Schedule
              </a>
            </td>
          </tr>

          <tr><td style="padding:24px 32px 0;"><hr style="border:none;border-top:1px solid ${LINE};margin:0;"></td></tr>

          <tr>
            <td style="padding:16px 32px 28px;font-size:12px;line-height:1.6;color:${MUTED};">
              <p style="margin:0 0 6px;">
                If this assignment doesn't work for you, please contact your Deacons School coordinator.
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

  const text = `Hi ${firstName},

You've been assigned to teach ${role} for ${className} on ${formatDate(calendarDay)}.

View your schedule: ${scheduleUrl || "https://www.stgeorgecocnashville.org/login"}

If this assignment doesn't work for you, please contact your Deacons School coordinator.

St. George Coptic Orthodox Church
2412 Foster Avenue, Nashville, TN`;

  return { subject, html, text };
}

module.exports = { renderTeacherAssignmentEmail };
