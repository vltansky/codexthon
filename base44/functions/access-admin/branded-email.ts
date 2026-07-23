interface BrandedAccessEmailInput {
  displayName: string;
  accessUrl: string;
  imageUrl: string;
}

export function buildBrandedAccessEmail(input: BrandedAccessEmailInput): { subject: string; html: string } {
  const displayName = escapeHtml(input.displayName);
  const accessUrl = escapeHtml(input.accessUrl);
  const imageUrl = escapeHtml(input.imageUrl);
  return {
    subject: "You're checked in — your promo code is ready",
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#020711;color:#f4f7ff;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#020711;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#07101d;border:1px solid #24344d;">
            <tr>
              <td><img src="${imageUrl}" width="638" alt="Earth at sunrise" style="display:block;width:100%;height:auto;border:0;"></td>
            </tr>
            <tr>
              <td style="padding:42px 38px 18px;color:#ff9a52;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Codex community hackathon</td>
            </tr>
            <tr>
              <td style="padding:0 38px;color:#ffffff;font-size:42px;font-weight:600;line-height:1.02;letter-spacing:-1.8px;">You’re checked in.<br>Your promo code is ready.</td>
            </tr>
            <tr>
              <td style="padding:24px 38px 0;color:#c7d2e3;font-size:16px;line-height:1.6;">Hi ${displayName},</td>
            </tr>
            <tr>
              <td style="padding:8px 38px 0;color:#c7d2e3;font-size:16px;line-height:1.6;">Check-in confirmed for OpenAI Build Week Tel Aviv. Your personal ChatGPT promo code is now unlocked.</td>
            </tr>
            <tr>
              <td style="padding:30px 38px 38px;"><a href="${accessUrl}" style="display:inline-block;background:#ff9a52;color:#07101d;padding:15px 22px;border-radius:999px;font-size:15px;font-weight:700;text-decoration:none;">View my promo code</a></td>
            </tr>
            <tr>
              <td style="padding:22px 38px;border-top:1px solid #24344d;color:#8290a5;font-size:12px;line-height:1.5;">This link is personal. Do not forward it. OpenAI Build Week Tel Aviv.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]!);
}
