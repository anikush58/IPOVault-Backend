import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { UserService } from './user.service';
import { UserEntitlementService } from './user-entitlement.service';
import { syncPansBodySchema } from './dto/sync-pans.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('user')
@UseGuards(FirebaseAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userEntitlementService: UserEntitlementService,
  ) {}

  /**
   * Retrieves the canonical entitlement tier for the authenticated user.
   * Client identity is strictly derived from the verified Firebase Auth token.
   */
  @Get('entitlement')
  @HttpCode(HttpStatus.OK)
  async getMyEntitlement(@CurrentUser('uid') userId: string) {
    return this.userEntitlementService.getEntitlement(userId);
  }

  @Post('pans/sync')
  @HttpCode(HttpStatus.OK)
  async syncPans(
    @Body() body: unknown,
    @CurrentUser('uid') userId: string,
  ) {
    const validated = syncPansBodySchema.parse(body);
    return this.userService.syncPans(userId, validated);
  }

  @Delete('pans/:id')
  @HttpCode(HttpStatus.OK)
  async deletePan(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.userService.deletePan(userId, id);
  }

  @Delete('pans')
  @HttpCode(HttpStatus.OK)
  async deleteAllPans(@CurrentUser('uid') userId: string) {
    return this.userService.deleteAllPans(userId);
  }

  /**
   * Authenticated user account deletion endpoint.
   * Permanently purges all server-side records owned by the authenticated user.
   * Google Play Compliance: User Data Deletion Policy.
   */
  @Delete('account')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@CurrentUser('uid') userId: string) {
    return this.userService.deleteUserAccount(userId);
  }

  /**
   * Public deletion request intake endpoint for web portal or users without app installed.
   * Dispatches an HMAC-signed confirmation link to the account owner.
   */
  @Post('deletion-request')
  @Public()
  @HttpCode(HttpStatus.OK)
  async requestDeletion(
    @Body() body: { email?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return this.userService.requestAccountDeletionByEmail(body?.email || '');
  }

  /**
   * Non-destructive GET endpoint: Verifies token and renders the confirmation page ONLY.
   * Email link scanners and browser prefetch bots issuing GET requests NEVER trigger deletion.
   */
  @Get('confirm-deletion')
  @Public()
  async getConfirmDeletionPage(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    try {
      const payload = await this.userService.verifyDeletionToken(token);
      const maskedEmail = escapeHtml(maskEmailForDisplay(payload.email));
      const safeToken = escapeHtml(token);

      return res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Confirm Account Deletion - IPOVault</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 36px; max-width: 520px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); text-align: center; }
    .icon { width: 64px; height: 64px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 20px; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px; color: #ffffff; }
    p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px; }
    .warning-box { background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; padding: 16px; text-align: left; font-size: 13px; color: #fca5a5; margin-bottom: 24px; }
    .warning-box strong { color: #ffffff; display: block; margin-bottom: 6px; }
    .warning-box ul { margin: 0; padding-left: 18px; }
    .warning-box li { margin-bottom: 4px; }
    .btn-group { display: flex; flex-direction: column; gap: 12px; }
    .btn { display: block; width: 100%; padding: 14px 20px; border-radius: 8px; font-weight: 600; font-size: 15px; cursor: pointer; text-decoration: none; border: none; box-sizing: border-box; font-family: inherit; }
    .btn-danger { background: #dc2626; color: #ffffff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-secondary { background: transparent; color: #94a3b8; border: 1px solid #374151; }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.05); color: #ffffff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Confirm Account Deletion</h1>
    <p>You have requested to permanently delete the IPOVault account associated with <strong>${maskedEmail}</strong>.</p>
    
    <div class="warning-box">
      <strong>This action is permanent and irreversible:</strong>
      <ul>
        <li>All saved PAN numbers and profile linkages will be deleted.</li>
        <li>Linked broker connections, tokens, and Demat holdings will be wiped.</li>
        <li>Your cloud synchronization profile and push notification tokens will be removed.</li>
        <li>Your login credentials will be permanently disabled.</li>
      </ul>
    </div>

    <form method="POST" action="/api/v1/user/confirm-deletion">
      <input type="hidden" name="token" value="${safeToken}">
      <div class="btn-group">
        <button type="submit" class="btn btn-danger">Confirm &amp; Permanently Delete Account</button>
        <a href="/" class="btn btn-secondary">Cancel &amp; Keep Account</a>
      </div>
    </form>
  </div>
</body>
</html>`);
    } catch (err: any) {
      return res.status(400).type('html').send(this.renderErrorPage(err?.message));
    }
  }

  /**
   * Explicit POST endpoint: Executes permanent account deletion.
   * Requires human confirmation submission. Safe against prefetch scanners.
   */
  @Post('confirm-deletion')
  @Public()
  async executeConfirmDeletion(
    @Body() body: { token?: string },
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    const token = body?.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).type('html').send(this.renderErrorPage('Missing confirmation token.'));
    }

    try {
      await this.userService.confirmAccountDeletion(token);
      return res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Account Deleted - IPOVault</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 36px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    .icon { width: 64px; height: 64px; background: rgba(16, 185, 129, 0.15); color: #10b981; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 20px; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #ffffff; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px; }
    .badge { display: inline-block; padding: 6px 14px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; font-size: 13px; font-weight: 600; border-radius: 9999px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Account Deleted Successfully</h1>
    <div class="badge">Permanent Deletion Complete</div>
    <p>Your IPOVault account and all associated personal data (saved PANs, linked broker accounts, notification preferences, push tokens, and cloud synchronization profiles) have been permanently deleted from our servers.</p>
    <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">You may now safely close this window.</p>
  </div>
</body>
</html>`);
    } catch (err: any) {
      const status = typeof err?.httpStatus === 'number' ? err.httpStatus : 400;
      return res.status(status).type('html').send(this.renderErrorPage(err?.message));
    }
  }

  private renderErrorPage(errorMessage?: string): string {
    const safeError = escapeHtml(
      errorMessage || 'This account deletion link is invalid or has expired. Please submit a new deletion request from the deletion portal.',
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>Invalid Deletion Link - IPOVault</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 36px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    .icon { width: 64px; height: 64px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 20px; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #ffffff; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 24px; }
    .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 8px; transition: background 0.2s; }
    .btn:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✕</div>
    <h1>Invalid or Expired Link</h1>
    <p>${safeError}</p>
    <a href="/delete-account" class="btn">Request New Link</a>
  </div>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function maskEmailForDisplay(email: string): string {
  if (!email || !email.includes('@')) return 'your account';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local.charAt(0)}***@${domain}`;
  }
  return `${local.slice(0, 2)}***${local.charAt(local.length - 1)}@${domain}`;
}
