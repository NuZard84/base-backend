import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { collaborationInviteTemplate } from './templates/collaboration-invite.template';
import { subscriptionConfirmTemplate } from './templates/subscription-confirm.template';

export interface SendCollabInviteInput {
    toEmail: string;
    inviterName: string;
    inviterEmail: string;
    canvasName: string;
    role: string;
    inviteLink: string;
}

export interface SendSubscriptionConfirmInput {
    toEmail: string;
    userName: string;
    planName: string;
    amount: string;
    billingDate: string;
    manageUrl: string;
}

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private readonly resend: Resend;
    private readonly fromAddress: string;

    constructor(private readonly config: ConfigService) {
        const apiKey = this.config.getOrThrow<string>('RESEND_API_KEY');
        this.resend = new Resend(apiKey);
        this.fromAddress = this.config.get<string>('EMAIL_FROM', 'TryDraft <noreply@mail.trydraft.app>');
    }

    async sendCollaborationInvite(input: SendCollabInviteInput): Promise<void> {
        const { toEmail, inviterName, canvasName, role, inviteLink } = input;

        const { error } = await this.resend.emails.send({
            from: this.fromAddress,
            to: toEmail,
            subject: `${inviterName} invited you to collaborate on "${canvasName}"`,
            html: collaborationInviteTemplate(input),
        });

        if (error) {
            this.logger.warn(
                `Failed to send collab invite to ${toEmail}: ${error.message}`,
            );
        } else {
            this.logger.log(`Collab invite sent to ${toEmail} for canvas "${canvasName}"`);
        }
    }

    async sendSubscriptionConfirmation(input: SendSubscriptionConfirmInput): Promise<void> {
        const { toEmail, userName, planName } = input;

        const { error } = await this.resend.emails.send({
            from: this.fromAddress,
            to: toEmail,
            subject: `You're now on TryDraft ${planName}`,
            html: subscriptionConfirmTemplate(input),
        });

        if (error) {
            this.logger.warn(
                `Failed to send subscription confirm to ${toEmail}: ${error.message}`,
            );
        } else {
            this.logger.log(`Subscription confirmation sent to ${toEmail} (plan: ${planName})`);
        }
    }
}
