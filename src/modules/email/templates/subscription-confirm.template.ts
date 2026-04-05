import { SendSubscriptionConfirmInput } from '../email.service';


export function subscriptionConfirmTemplate(input: SendSubscriptionConfirmInput): string {
    const { userName, planName, amount, billingDate, manageUrl } = input;
    const year = new Date().getFullYear();
    const firstName = escapeHtml(userName.split(' ')[0]);
    const safePlanName = escapeHtml(planName);
    const safeAmount = escapeHtml(amount);
    const safeBillingDate = escapeHtml(billingDate);
    const safeManageUrl = escapeHtml(manageUrl);

    const features = getPlanFeatures(planName);
    const featureRows = features.map(f =>
        '<tr><td style="padding:4px 0;">' +
        '<table role="presentation" cellspacing="0" cellpadding="0"><tr>' +
        '<td style="width:18px;vertical-align:top;padding-top:2px;">' +
        '<span style="display:inline-block;width:14px;height:14px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:50%;text-align:center;line-height:14px;font-size:8px;color:#3b82f6;font-weight:700;">&#10003;</span>' +
        '</td>' +
        '<td style="padding-left:8px;font-size:13px;color:#52525b;">' + escapeHtml(f) + '</td>' +
        '</tr></table>' +
        '</td></tr>',
    ).join('');

    return '<!DOCTYPE html>' +
        '<html lang="en">' +
        '<head>' +
        '<meta charset="UTF-8" />' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
        '<title>Subscription Confirmed</title>' +
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

        // Check icon + headline
        '<tr><td style="padding:28px 40px 0 40px;text-align:center;">' +
        '<div style="display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background-color:#eff6ff;border:2px solid #bfdbfe;font-size:22px;color:#3b82f6;line-height:52px;margin-bottom:18px;">&#10003;</div>' +
        '<h1 style="margin:0 0 10px 0;font-size:22px;font-weight:700;color:#09090b;line-height:1.3;">' +
        'You\'re on TryDraft ' + safePlanName + '!' +
        '</h1>' +
        '<p style="margin:0;font-size:15px;color:#52525b;line-height:1.6;">' +
        'Thanks ' + firstName + ', your subscription is now active.' +
        '</p>' +
        '</td></tr>' +

        // Plan summary card
        '<tr><td style="padding:28px 40px 0 40px;">' +
        '<table role="presentation" width="100%" style="border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;">' +

        // Plan row
        '<tr><td style="padding:20px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
        '<td style="width:42px;vertical-align:middle;">' +
        '<div style="width:38px;height:38px;background:#eff6ff;border-radius:8px;border:1px solid #dbeafe;text-align:center;line-height:38px;font-size:18px;color:#3b82f6;">&#9889;</div>' +
        '</td>' +
        '<td style="padding-left:12px;vertical-align:middle;">' +
        '<p style="margin:0 0 2px 0;font-size:15px;font-weight:600;color:#09090b;">TryDraft ' + safePlanName + '</p>' +
        '<p style="margin:0;font-size:12px;color:#71717a;">Monthly subscription</p>' +
        '</td>' +
        '<td style="text-align:right;vertical-align:middle;">' +
        '<p style="margin:0 0 2px 0;font-size:18px;font-weight:700;color:#09090b;">' + safeAmount + '</p>' +
        '<p style="margin:0;font-size:11px;color:#71717a;">per month</p>' +
        '</td>' +
        '</tr></table>' +
        '</td></tr>' +

        // Divider
        '<tr><td style="height:1px;background-color:#f4f4f5;"></td></tr>' +

        // Billing date
        '<tr><td style="padding:12px 20px;background-color:#fafafa;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
        '<td style="font-size:12px;color:#71717a;">Next billing date</td>' +
        '<td style="text-align:right;font-size:12px;color:#18181b;font-weight:500;">' + safeBillingDate + '</td>' +
        '</tr></table>' +
        '</td></tr>' +

        '</table>' +
        '</td></tr>' +

        // Features
        '<tr><td style="padding:24px 40px 0 40px;">' +
        '<p style="margin:0 0 12px 0;font-size:12px;font-weight:700;color:#71717a;letter-spacing:1px;text-transform:uppercase;">What\'s included</p>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' +
        featureRows +
        '</table>' +
        '</td></tr>' +

        // CTA
        '<tr><td style="padding:32px 40px 0 40px;text-align:center;">' +
        '<a href="' + safeManageUrl + '" style="display:inline-block;width:100%;box-sizing:border-box;padding:14px 0;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;text-align:center;">Start Creating &rarr;</a>' +
        '</td></tr>' +

        // Manage billing note
        '<tr><td style="padding:14px 40px 0 40px;text-align:center;">' +
        '<p style="margin:0;font-size:12px;color:#71717a;">' +
        'Need to change or cancel? Visit your ' +
        '<a href="' + safeManageUrl + '/billing" style="color:#3b82f6;text-decoration:none;">billing settings</a>.' +
        '</p>' +
        '</td></tr>' +

        // Spacer
        '<tr><td style="padding:36px 0 0 0;"></td></tr>' +

        '</table>' +

        // Footer
        '<table role="presentation" width="100%" style="max-width:520px;">' +
        '<tr><td style="padding:20px;text-align:center;">' +
        '<p style="margin:0 0 6px 0;font-size:12px;color:#71717a;line-height:1.6;">' +
        'This receipt confirms your TryDraft subscription.<br/>' +
        'Questions? Reply to this email or visit our support.' +
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

function getPlanFeatures(planName: string): string[] {
    if (planName === 'Pro') {
        return [
            'Unlimited canvases',
            'AI-powered content generation',
            'Real-time collaboration with your team',
            'Advanced export options',
            'Priority support',
        ];
    }
    if (planName === 'Plus') {
        return [
            'Up to 20 canvases',
            'AI content generation',
            'Collaborate with up to 5 members',
            'Standard export options',
        ];
    }
    return ['3 canvases', 'Basic AI features', 'Solo workspace'];
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
