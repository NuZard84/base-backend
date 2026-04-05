import { SendCollabInviteInput } from '../email.service';

const ROLE_LABELS: Record<string, string> = {
    OWNER: 'Owner',
    EDITOR: 'Editor',
    COMMENTOR: 'Commenter',
    VIEWER: 'Viewer',
};


export function collaborationInviteTemplate(input: SendCollabInviteInput): string {
    const { inviterName, inviterEmail, canvasName, role, inviteLink } = input;
    const roleLabel = ROLE_LABELS[role] ?? role;
    const year = new Date().getFullYear();
    const safeInviterName = escapeHtml(inviterName);
    const safeInviterEmail = escapeHtml(inviterEmail);
    const safeCanvasName = escapeHtml(canvasName);
    const safeInviteLink = escapeHtml(inviteLink);

    return '<!DOCTYPE html>' +
        '<html lang="en">' +
        '<head>' +
        '<meta charset="UTF-8" />' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
        '<title>Collaboration Invite</title>' +
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

        // Headline
        '<tr><td style="padding:28px 40px 0 40px;text-align:center;">' +
        '<h1 style="margin:0 0 10px 0;font-size:22px;font-weight:700;color:#09090b;line-height:1.3;">' +
        'You\'ve been invited to collaborate' +
        '</h1>' +
        '<p style="margin:0;font-size:15px;color:#52525b;line-height:1.6;">' +
        '<strong style="color:#09090b;">' + safeInviterName + '</strong>' +
        ' invited you to join a canvas on TryDraft' +
        '</p>' +
        '</td></tr>' +

        // Canvas info card
        '<tr><td style="padding:28px 40px 0 40px;">' +
        '<table role="presentation" width="100%" style="border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;">' +

        // Canvas row
        '<tr><td style="padding:20px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
        '<td style="width:38px;vertical-align:middle;">' +
        '<div style="width:38px;height:38px;background:#eff6ff;border-radius:8px;border:1px solid #dbeafe;text-align:center;line-height:38px;font-size:17px;color:#3b82f6;">&#9998;</div>' +
        '</td>' +
        '<td style="padding-left:12px;vertical-align:middle;">' +
        '<p style="margin:0 0 2px 0;font-size:15px;font-weight:600;color:#09090b;">' + safeCanvasName + '</p>' +
        '<p style="margin:0;font-size:12px;color:#71717a;">Canvas</p>' +
        '</td>' +
        '<td style="text-align:right;vertical-align:middle;">' +
        '<span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;background-color:#eff6ff;color:#3b82f6;border:1px solid #bfdbfe;">' +
        roleLabel +
        '</span>' +
        '</td>' +
        '</tr></table>' +
        '</td></tr>' +

        // Divider
        '<tr><td style="height:1px;background-color:#f4f4f5;"></td></tr>' +

        // Invited by row
        '<tr><td style="padding:12px 20px;background-color:#fafafa;">' +
        '<p style="margin:0;font-size:12px;color:#71717a;">' +
        'Invited by <span style="color:#18181b;font-weight:600;">' + safeInviterName + '</span>' +
        ' &middot; ' +
        '<span style="color:#52525b;">' + safeInviterEmail + '</span>' +
        '</p>' +
        '</td></tr>' +

        '</table>' +
        '</td></tr>' +

        // CTA Button
        '<tr><td style="padding:32px 40px 0 40px;text-align:center;">' +
        '<a href="' + safeInviteLink + '" style="display:inline-block;width:100%;box-sizing:border-box;padding:14px 0;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">Open Canvas &rarr;</a>' +
        '</td></tr>' +

        // Link fallback
        '<tr><td style="padding:18px 40px 0 40px;text-align:center;">' +
        '<p style="margin:0 0 6px 0;font-size:12px;color:#71717a;">Or copy this link:</p>' +
        '<p style="margin:0;font-size:11px;word-break:break-all;background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;padding:8px 12px;">' +
        '<a href="' + safeInviteLink + '" style="color:#3b82f6;text-decoration:none;">' + safeInviteLink + '</a>' +
        '</p>' +
        '</td></tr>' +

        // Spacer
        '<tr><td style="padding:36px 0 0 0;"></td></tr>' +

        '</table>' +

        // Footer
        '<table role="presentation" width="100%" style="max-width:520px;">' +
        '<tr><td style="padding:20px;text-align:center;">' +
        '<p style="margin:0 0 6px 0;font-size:12px;color:#71717a;line-height:1.6;">' +
        'You received this because someone invited you to collaborate on TryDraft.<br/>' +
        'If you weren\'t expecting this, you can safely ignore it.' +
        '</p>' +
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
