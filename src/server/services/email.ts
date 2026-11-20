import nodemailer from 'nodemailer';
import { AppError } from '../errors.ts';

export const DEFAULT_DEV_SENDER = 'onboarding@resend.dev';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export interface SmtpVerificationResult {
  envVarsPresent: {
    SMTP_HOST: boolean;
    SMTP_PORT: boolean;
    SMTP_USER: boolean;
    SMTP_PASS: boolean;
    EMAIL_FROM: boolean;
    RESEND_API_KEY: boolean;
  };
  transport: 'smtp' | 'resend_api' | 'none';
  host: string | null;
  port: number | null;
  secure: boolean | null;
  from: string | null;
  verified: boolean;
  message: string;
  errorCode?: string;
}

function resolveSenderAddress(): string {
  const configured = process.env.EMAIL_FROM?.trim();
  if (configured && configured.includes('@')) {
    return configured;
  }
  return DEFAULT_DEV_SENDER;
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 587;
  const user =
    process.env.SMTP_USER?.trim() ||
    (host === 'smtp.resend.com' ? 'resend' : undefined);
  const pass =
    process.env.SMTP_PASS?.trim() ||
    (host === 'smtp.resend.com' ? process.env.RESEND_API_KEY?.trim() : undefined);
  const from = resolveSenderAddress();

  if (host && user && pass && Number.isFinite(port)) {
    return {
      host,
      port,
      secure: port === 465,
      user,
      pass,
      from,
    };
  }
  return null;
}

export function getResendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveSenderAddress();
  if (apiKey) {
    return { apiKey, from };
  }
  return null;
}

export function isEmailProviderConfigured(): boolean {
  return Boolean(getSmtpConfig() || getResendConfig());
}

export function getMissingEmailConfigMessage(): string {
  return 'Email delivery is not configured on this server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM (or RESEND_API_KEY and EMAIL_FROM) in environment variables.';
}

function formatProviderError(error: unknown, contextLabel: string): {
  status: number;
  message: string;
  code?: string;
} {
  const errObj = error as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };

  const code =
    errObj?.code ||
    (errObj?.responseCode ? String(errObj.responseCode) : undefined);
  const rawDetails = (errObj?.response || errObj?.message || '').trim();
  const lower = rawDetails.toLowerCase();

  if (
    errObj?.responseCode === 535 ||
    errObj?.code === 'EAUTH' ||
    lower.includes('invalid login') ||
    lower.includes('authentication failed') ||
    lower.includes('api key is invalid')
  ) {
    return {
      status: 424,
      code,
      message: `${contextLabel} authentication failed: ${rawDetails || 'Invalid SMTP or Resend credentials.'}`,
    };
  }

  if (
    lower.includes('only send testing emails') ||
    lower.includes('verify a domain') ||
    lower.includes('validation_error') ||
    errObj?.responseCode === 450 ||
    errObj?.responseCode === 550
  ) {
    return {
      status: 422,
      code,
      message: `${contextLabel} rejected the recipient due to Resend sandbox/domain restrictions (${rawDetails}). With ${DEFAULT_DEV_SENDER}, Resend only delivers to your verified Resend account email address until a custom domain is verified.`,
    };
  }

  if (
    errObj?.code === 'ECONNREFUSED' ||
    errObj?.code === 'ETIMEDOUT' ||
    errObj?.code === 'ENOTFOUND' ||
    errObj?.code === 'ESOCKET'
  ) {
    return {
      status: 424,
      code,
      message: `${contextLabel} connection failed (${errObj.code}): ${rawDetails || 'Unable to reach mail server.'}`,
    };
  }

  return {
    status: 424,
    code,
    message: rawDetails
      ? `${contextLabel} failed: ${rawDetails}`
      : `${contextLabel} failed unexpectedly.`,
  };
}

export async function verifySmtpConnection(): Promise<SmtpVerificationResult> {
  const envVarsPresent = {
    SMTP_HOST: Boolean(process.env.SMTP_HOST?.trim()),
    SMTP_PORT: Boolean(process.env.SMTP_PORT?.trim()),
    SMTP_USER: Boolean(process.env.SMTP_USER?.trim()),
    SMTP_PASS: Boolean(process.env.SMTP_PASS?.trim()),
    EMAIL_FROM: Boolean(process.env.EMAIL_FROM?.trim()),
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY?.trim()),
  };

  const smtp = getSmtpConfig();
  if (smtp) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    try {
      await transporter.verify();
      return {
        envVarsPresent,
        transport: 'smtp',
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        from: smtp.from,
        verified: true,
        message: `SMTP connection and authentication succeeded (${smtp.host}:${smtp.port}, sender: ${smtp.from}).`,
      };
    } catch (error) {
      const formatted = formatProviderError(error, 'SMTP verification');
      return {
        envVarsPresent,
        transport: 'smtp',
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        from: smtp.from,
        verified: false,
        message: formatted.message,
        errorCode: formatted.code,
      };
    }
  }

  const resend = getResendConfig();
  if (resend) {
    try {
      const response = await fetch('https://api.resend.com/domains', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${resend.apiKey}`,
        },
      });
      if (!response.ok) {
        const errText = await response.text();
        return {
          envVarsPresent,
          transport: 'resend_api',
          host: 'api.resend.com',
          port: 443,
          secure: true,
          from: resend.from,
          verified: false,
          message: `SMTP variables are not set; Resend API check failed (${response.status}): ${errText}`,
          errorCode: String(response.status),
        };
      }
      return {
        envVarsPresent,
        transport: 'resend_api',
        host: 'api.resend.com',
        port: 443,
        secure: true,
        from: resend.from,
        verified: true,
        message: `SMTP variables are not set; Resend HTTP API credentials verified (sender: ${resend.from}).`,
      };
    } catch (error) {
      const formatted = formatProviderError(error, 'Resend API verification');
      return {
        envVarsPresent,
        transport: 'resend_api',
        host: 'api.resend.com',
        port: 443,
        secure: true,
        from: resend.from,
        verified: false,
        message: formatted.message,
        errorCode: formatted.code,
      };
    }
  }

  return {
    envVarsPresent,
    transport: 'none',
    host: null,
    port: null,
    secure: null,
    from: null,
    verified: false,
    message: getMissingEmailConfigMessage(),
  };
}

export type EmailDeliveryStatus = 'FAILED' | 'SENT' | 'DELIVERED' | 'BOUNCED';

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  emailId: string | null;
  provider: 'resend' | 'smtp';
  lastEvent: string | null;
  message: string;
}

function mapResendEventToStatus(lastEvent: string | null | undefined): EmailDeliveryStatus {
  const normalized = (lastEvent || '').trim().toLowerCase();
  if (normalized === 'delivered') return 'DELIVERED';
  if (normalized === 'bounced' || normalized === 'complained') return 'BOUNCED';
  if (normalized === 'failed' || normalized === 'canceled') return 'FAILED';
  return 'SENT';
}

export async function getResendEmailStatus(emailId: string): Promise<EmailDeliveryResult> {
  const resend = getResendConfig();
  if (!resend) {
    throw new AppError(424, getMissingEmailConfigMessage());
  }

  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
      },
    });

    const rawBody = await response.text();
    if (!response.ok) {
      let providerMsg = rawBody;
      try {
        const parsed = JSON.parse(rawBody) as { message?: string };
        if (parsed.message) providerMsg = parsed.message;
      } catch {
        // keep rawBody
      }
      const formatted = formatProviderError(
        { responseCode: response.status, message: providerMsg },
        'Resend email status check'
      );
      throw new AppError(formatted.status, formatted.message);
    }

    const data = JSON.parse(rawBody) as { id?: string; last_event?: string };
    const lastEvent = data.last_event ?? 'sent';
    const status = mapResendEventToStatus(lastEvent);
    const messageMap: Record<EmailDeliveryStatus, string> = {
      SENT: 'Email accepted by Resend for delivery.',
      DELIVERED: 'Recipient mail server confirmed delivery.',
      BOUNCED: 'Recipient mail server bounced or rejected the email.',
      FAILED: 'Email delivery failed.',
    };

    return {
      status,
      emailId: data.id || emailId,
      provider: 'resend',
      lastEvent,
      message: messageMap[status],
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const formatted = formatProviderError(error, 'Resend email status check');
    throw new AppError(formatted.status, formatted.message, { cause: error });
  }
}

async function sendViaResendApi(
  resend: ResendConfig,
  input: { to: string; subject: string; text: string; html: string }
): Promise<EmailDeliveryResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resend.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    let providerMsg = rawBody;
    try {
      const parsed = JSON.parse(rawBody) as { message?: string; name?: string };
      if (parsed.message) providerMsg = parsed.message;
    } catch {
      // keep rawBody
    }
    const formatted = formatProviderError(
      { responseCode: response.status, message: providerMsg },
      'Resend email delivery'
    );
    console.error('Resend API error:', response.status, providerMsg);
    throw new AppError(formatted.status, formatted.message);
  }

  let emailId: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { id?: string };
    if (parsed.id) emailId = parsed.id;
  } catch {
    // ignore parse error
  }

  if (!emailId) {
    console.error('Resend API returned 200 without an email ID:', rawBody);
    throw new AppError(424, 'Resend did not return an email confirmation ID.');
  }

  // Inspect delivery event status if available immediately without masking acceptance
  try {
    return await getResendEmailStatus(emailId);
  } catch {
    return {
      status: 'SENT',
      emailId,
      provider: 'resend',
      lastEvent: 'sent',
      message: 'Email accepted by Resend for delivery.',
    };
  }
}

async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  preferResendApi?: boolean;
}): Promise<EmailDeliveryResult> {
  const resend = getResendConfig();
  const smtp = getSmtpConfig();

  if (resend && (input.preferResendApi || !smtp || smtp.host === 'smtp.resend.com')) {
    try {
      return await sendViaResendApi(resend, input);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const formatted = formatProviderError(error, 'Resend email delivery');
      console.error('Resend email delivery failed:', formatted.message);
      throw new AppError(formatted.status, formatted.message, {
        cause: error,
      });
    }
  }

  if (smtp) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      });
      const info = await transporter.sendMail({
        from: smtp.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return {
        status: 'SENT',
        emailId: info.messageId || null,
        provider: 'smtp',
        lastEvent: 'sent',
        message: 'Email accepted by SMTP server for delivery.',
      };
    } catch (error) {
      const formatted = formatProviderError(error, 'SMTP email delivery');
      console.error('SMTP email delivery failed:', formatted.message);
      throw new AppError(formatted.status, formatted.message, {
        cause: error,
      });
    }
  }

  throw new AppError(424, getMissingEmailConfigMessage());
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  verifyUrl: string
) {
  return sendEmail({
    to,
    subject: 'Verify your DevTrack email address',
    text: `Hello ${name},\n\nVerify your email address for DevTrack by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.\n`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Please verify your email address for DevTrack by clicking the link below:</p><p><a href="${verifyUrl}">Verify Email Address</a></p><p>This link expires in 24 hours. If you did not create a DevTrack account, you can ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  resetUrl: string
) {
  return sendEmail({
    to,
    subject: 'Reset your DevTrack password',
    text: `Hello ${name},\n\nReset your DevTrack password by visiting:\n${resetUrl}\n\nThis link expires in 1 hour and can only be used once.\n`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>We received a request to reset your DevTrack password. Click the link below to set a new password:</p><p><a href="${resetUrl}">Reset Password</a></p><p>This link expires in 1 hour and can only be used once. If you did not request this, you can safely ignore this email.</p>`,
  });
}

export async function sendProjectInvitationEmail(input: {
  to: string;
  projectName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  token: string;
  expiresAt: Date;
}): Promise<EmailDeliveryResult> {
  const expiresLabel = input.expiresAt.toUTCString();
  const roleLabel = input.role === 'ADMINISTRATOR' ? 'Administrator' : 'Member';

  const result = await sendEmail({
    to: input.to,
    subject: `${input.inviterName} invited you to collaborate on "${input.projectName}" in DevTrack`,
    text:
      `Hello,\n\n` +
      `${input.inviterName} has invited you to join the project "${input.projectName}" on DevTrack as a ${roleLabel}.\n\n` +
      `Accept your invitation by opening DevTrack:\n${input.acceptUrl}\n\n` +
      `Or paste this invitation token in the Team section after signing in with ${input.to}:\n${input.token}\n\n` +
      `This invitation expires on ${expiresLabel}.\n`,
    html:
      `<p>Hello,</p>` +
      `<p><strong>${escapeHtml(input.inviterName)}</strong> has invited you to collaborate on <strong>${escapeHtml(input.projectName)}</strong> in DevTrack as a <strong>${escapeHtml(roleLabel)}</strong>.</p>` +
      `<p><a href="${input.acceptUrl}">Open DevTrack to Accept Invitation</a></p>` +
      `<p>If needed, sign in with <strong>${escapeHtml(input.to)}</strong>, open the <strong>Team</strong> section, and redeem this invitation token:</p>` +
      `<p><code>${escapeHtml(input.token)}</code></p>` +
      `<p>This invitation expires on ${escapeHtml(expiresLabel)}.</p>`,
    preferResendApi: true,
  });

  if (result.status === 'BOUNCED' || result.status === 'FAILED') {
    throw new AppError(424, result.message);
  }

  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
