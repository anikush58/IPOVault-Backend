import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Env } from '../../config/env';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { RESEND_CLIENT } from './email.constants';
import { escapeHtml, maskEmailForDisplay } from './email.util';

export interface SendEmailResult {
  id?: string;
  skipped?: boolean;
}

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private readonly resend: Resend | null = null;
  private readonly emailFrom: string;
  private readonly publicAppUrl: string;
  private readonly nodeEnv: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(RESEND_CLIENT) injectedResend?: Resend,
  ) {
    this.nodeEnv =
      this.config.get<string>('NODE_ENV', { infer: true }) || 'development';
    this.emailFrom =
      this.config.get<string>('EMAIL_FROM', { infer: true }) ||
      'IPOVault Security <noreply@getipovault.in>';
    this.publicAppUrl = (
      this.config.get<string>('PUBLIC_APP_URL', { infer: true }) ||
      'https://getipovault.in'
    ).replace(/\/+$/, '');

    const apiKey = this.config.get<string>('RESEND_API_KEY', { infer: true });

    if (injectedResend) {
      this.resend = injectedResend;
    } else if (apiKey && apiKey.trim().length > 0) {
      this.resend = new Resend(apiKey.trim());
    } else if (this.nodeEnv === 'production') {
      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        'RESEND_API_KEY must be configured in production environment',
        500,
      );
    }
  }

  /**
   * Constructs the canonical, HMAC-authenticated account deletion confirmation URL.
   * Trailing slashes on the base URL are cleanly normalized.
   */
  buildConfirmationUrl(token: string): string {
    return `${this.publicAppUrl}/api/v1/user/confirm-deletion?token=${encodeURIComponent(token)}`;
  }

  /**
   * Dispatches a single-use account deletion verification email via Resend.
   *
   * Security Guarantees:
   * - Never logs raw confirmation tokens or API keys.
   * - Recipient email addresses are masked in all logs.
   * - If Resend returns an error or times out, throws AppException to fail closed.
   * - Avoids blind automatic duplicate retries to prevent duplicate emails.
   */
  async sendAccountDeletionConfirmation(
    recipientEmail: string,
    uid: string,
    token: string,
  ): Promise<SendEmailResult> {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'A valid recipient email address is required',
        400,
      );
    }

    const cleanEmail = recipientEmail.trim().toLowerCase();
    const maskedEmail = maskEmailForDisplay(cleanEmail);
    const confirmationUrl = this.buildConfirmationUrl(token);

    if (!this.resend) {
      if (this.nodeEnv === 'production') {
        throw new AppException(
          ErrorCode.INTERNAL_ERROR,
          'Email provider is not configured in production environment',
          500,
        );
      }
      this.logger.warn(
        `RESEND_API_KEY not configured; skipping email dispatch to ${maskedEmail} in ${this.nodeEnv} mode`,
      );
      return { skipped: true };
    }

    const subject = 'Confirm Permanent Deletion of Your IPOVault Account';
    const text = `Hello,

We received a request to permanently delete the IPOVault account associated with this email address.

To confirm this request and permanently delete your account, click the link below (valid for 15 minutes):
${confirmationUrl}

If you did not request this deletion, you can safely ignore this email. Your account and data will remain secure and unchanged.

— The IPOVault Security Team
`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 24px; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);">
    <div style="display: inline-block; background-color: rgba(239, 68, 68, 0.15); border-radius: 8px; padding: 8px 12px; margin-bottom: 16px;">
      <span style="color: #ef4444; font-size: 16px; font-weight: bold;">⚠️ IPOVault Security</span>
    </div>
    <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0 0 16px;">Account Deletion Request</h1>
    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
      We received a request to permanently delete the IPOVault account associated with <strong style="color: #f8fafc;">${escapeHtml(maskedEmail)}</strong>.
    </p>
    <div style="background-color: rgba(239, 68, 68, 0.08); border-left: 4px solid #ef4444; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px;">
      <p style="color: #fca5a5; font-size: 13px; line-height: 1.5; margin: 0;">
        <strong>Warning:</strong> Confirming this deletion will permanently purge all saved PANs, linked broker accounts, Demat holdings, synchronized applications, and notification tokens. This action is irreversible.
      </p>
    </div>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${confirmationUrl}" style="background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">
        Confirm &amp; Permanently Delete Account
      </a>
    </div>
    <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 24px 0 0;">
      Button not working? Copy and paste this link into your browser:<br>
      <a href="${confirmationUrl}" style="color: #3b82f6; word-break: break-all;">${confirmationUrl}</a>
    </p>
    <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 16px 0 0;">
      This link is single-use and will expire in 15 minutes.<br>
      If you did not request this deletion, please ignore this email. Your account remains completely secure.
    </p>
  </div>
</body>
</html>`;

    let response: any;
    try {
      response = await this.resend.emails.send({
        from: this.emailFrom,
        to: cleanEmail,
        subject,
        text,
        html,
      });
    } catch (err: any) {
      this.logger.error(
        `Resend network error dispatching deletion email for uid: ${uid}: ${err?.message || 'Unknown network error'}`,
      );
      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        'Failed to dispatch verification email due to a provider network error. Please try again later.',
        500,
      );
    }

    if (response?.error) {
      this.logger.error(
        `Resend rejected deletion email for uid: ${uid}: ${response.error.name} - ${response.error.message}`,
      );
      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        'Failed to dispatch verification email. Please try again later.',
        500,
      );
    }

    this.logger.log(
      `Account deletion confirmation email dispatched successfully for uid: ${uid}, recipient: ${maskedEmail}, messageId: ${response?.data?.id || 'unknown'}`,
    );

    return { id: response?.data?.id };
  }
}
