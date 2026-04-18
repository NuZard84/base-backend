export interface PasswordResetInput {
    toEmail: string;
    userName: string;
    resetUrl: string;
}

export function passwordResetTemplate(input: PasswordResetInput): string {
    const { userName, resetUrl } = input;
    const year = new Date().getFullYear();
    const safeName = escapeHtml(userName);
    const safeUrl = escapeHtml(resetUrl);

    return '<!DOCTYPE html>' +
        '<html lang="en">' +
        '<head>' +
        '<meta charset="UTF-8" />' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
        '<title>Reset your password</title>' +
        '</head>' +
        '<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f5;">' +
        '<tr><td align="center" style="padding:48px 16px;">' +

        // Card
        '<table role="presentation" width="100%" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">' +

        // Top blue bar
        '<tr><td style="height:3px;background-color:#3b82f6;"></td></tr>' +

        // Logo + wordmark
        '<tr><td style="padding:36px 40px 0 40px;text-align:center;">' +
        '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 10px auto;">' +
        '<tr><td style="width:44px;height:44px;background-color:#3b82f6;border-radius:10px;text-align:center;vertical-align:middle;">' +
        '<span style="font-size:22px;font-weight:700;color:#ffffff;line-height:1;">T</span>' +
        '</td></tr></table>' +
        '<p style="margin:0;font-size:12px;font-weight:700;color:#3b82f6;letter-spacing:2px;text-transform:uppercase;">TryDraft</p>' +
        '</td></tr>' +

        // Lock icon + headline
        '<tr><td style="padding:28px 40px 0 40px;text-align:center;">' +
        '<div style="width:56px;height:56px;background-color:#eff6ff;border-radius:50%;margin:0 auto 20px auto;border:2px solid #bfdbfe;text-align:center;line-height:56px;">' +
        '<span style="font-size:24px;line-height:1;">&#128274;</span>' +
        '</div>' +
        '<h1 style="margin:0 0 10px 0;font-size:22px;font-weight:700;color:#09090b;line-height:1.3;">' +
        'Reset your password' +
        '</h1>' +
        '<p style="margin:0;font-size:15px;color:#52525b;line-height:1.6;">' +
        'Hi <strong style="color:#09090b;">' + safeName + '</strong>,<br/>' +
        'We received a request to reset your TryDraft password.<br/>Click the button below to choose a new one.' +
        '</p>' +
        '</td></tr>' +

        // CTA Button
        '<tr><td style="padding:32px 40px 0 40px;text-align:center;">' +
        '<a href="' + safeUrl + '" style="display:inline-block;width:100%;box-sizing:border-box;padding:14px 0;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">Reset Password &rarr;</a>' +
        '</td></tr>' +

        // Expiry notice
        '<tr><td style="padding:20px 40px 0 40px;text-align:center;">' +
        '<p style="margin:0;font-size:12px;color:#71717a;">This link expires in <strong>1 hour</strong>. After that you\'ll need to request a new one.</p>' +
        '</td></tr>' +

        // Link fallback
        '<tr><td style="padding:18px 40px 0 40px;text-align:center;">' +
        '<p style="margin:0 0 6px 0;font-size:12px;color:#71717a;">Button not working? Copy this link:</p>' +
        '<p style="margin:0;font-size:11px;word-break:break-all;background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:8px 12px;">' +
        '<a href="' + safeUrl + '" style="color:#3b82f6;text-decoration:none;">' + safeUrl + '</a>' +
        '</p>' +
        '</td></tr>' +

        // Security notice
        '<tr><td style="padding:20px 40px 0 40px;text-align:center;">' +
        '<div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;padding:12px 16px;">' +
        '<p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;">' +
        '<strong style="color:#52525b;">Didn\'t request this?</strong><br/>' +
        'You can safely ignore this email. Your password won\'t change.' +
        '</p>' +
        '</div>' +
        '</td></tr>' +

        // Spacer
        '<tr><td style="padding:36px 0 0 0;"></td></tr>' +

        '</table>' +

        // Footer
        '<table role="presentation" width="100%" style="max-width:520px;">' +
        '<tr><td style="padding:20px;text-align:center;">' +
        '<p style="margin:0;font-size:11px;color:#a1a1aa;">' +
        '&copy; ' + year + ' TryDraft &middot; ' +
        '<a href="https://trydraft.app" style="color:#71717a;text-decoration:none;">trydraft.app</a>' +
        '</p>' +
        '</td></tr>' +
        '</table>' +

        '</td></tr>' +
        '</table>' +
        '</body>' +
        '</html>';
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
