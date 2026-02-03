import nodemailer from 'nodemailer';

// Email provider type
type EmailProvider = 'gmail' | 'resend';

// Get current provider from env
const EMAIL_PROVIDER: EmailProvider = (process.env.EMAIL_PROVIDER as EmailProvider) || 'gmail';

// Delay between emails in milliseconds (default: 1 second)
const EMAIL_DELAY_MS = parseInt(process.env.EMAIL_DELAY_MS || '1000', 10);

// Gmail transporter
const gmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

// Resend transporter (SMTP)
const resendTransporter = nodemailer.createTransport({
    host: 'smtp.resend.com',
    port: 465,
    secure: true,
    auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY,
    },
});

// Get the appropriate transporter
function getTransporter() {
    if (EMAIL_PROVIDER === 'resend' && process.env.RESEND_API_KEY) {
        return resendTransporter;
    }
    return gmailTransporter;
}

// Get sender email
function getSenderEmail() {
    if (EMAIL_PROVIDER === 'resend' && process.env.RESEND_FROM_EMAIL) {
        return process.env.RESEND_FROM_EMAIL;
    }
    return process.env.GMAIL_USER;
}

// Utility function to delay execution
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get configured delay between emails
export function getEmailDelay(): number {
    return EMAIL_DELAY_MS;
}

export async function sendCertificateEmail({
    to,
    subject,
    html,
    attachments,
}: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}) {
    const transporter = getTransporter();
    const senderEmail = getSenderEmail();

    console.log(`[EMAIL] Provider: ${EMAIL_PROVIDER}`);
    console.log(`[EMAIL] Attempting to send email to: ${to}`);
    console.log(`[EMAIL] From: ${senderEmail}`);

    try {
        const info = await transporter.sendMail({
            from: `"Panitia Webinar" <${senderEmail}>`,
            to,
            subject,
            html,
            attachments,
        });

        console.log(`[EMAIL] ✅ Email sent successfully to ${to}`);
        return info;
    } catch (error) {
        console.error(`[EMAIL] ❌ Failed to send email to ${to}:`, error);
        throw error;
    }
}

// Batch email sending with delay
export async function sendEmailBatch(
    emails: Array<{
        to: string;
        subject: string;
        html: string;
        attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
    }>,
    onProgress?: (sent: number, total: number, currentEmail: string) => void
): Promise<{ success: number; failed: number; errors: string[] }> {
    const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
    };

    for (let i = 0; i < emails.length; i++) {
        const email = emails[i];

        try {
            await sendCertificateEmail(email);
            results.success++;

            if (onProgress) {
                onProgress(i + 1, emails.length, email.to);
            }
        } catch (error) {
            results.failed++;
            results.errors.push(`${email.to}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Add delay between emails (except for the last one)
        if (i < emails.length - 1) {
            await delay(EMAIL_DELAY_MS);
        }
    }

    console.log(`[EMAIL] Batch complete: ${results.success} sent, ${results.failed} failed`);
    return results;
}
