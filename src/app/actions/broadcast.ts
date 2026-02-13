'use server';

import { analyzeCertificate } from '@/lib/ai';
import { sendCertificateEmail, delay, getEmailDelay } from '@/lib/email';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { broadcastInputSchema, sanitizeHtml, isValidYoutubeUrl, recipientSchema, senderSchema } from '@/lib/validations';

type EmailTemplateInput = {
    recipientName: string;
    caption: string;
    eventName: string;
    eventDate: string;
    sender: { name: string; department: string; contact: string };
    youtubeUrl?: string;
};

function buildEmailTemplate({
    recipientName,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: EmailTemplateInput): { subject: string; html: string } {
    const personalizedCaption = caption
        .replace(/\[Nama\]/g, recipientName)
        .replace(/\[Nama Pengirim\]/g, sender.name)
        .replace(/\[Instansi\/Unit\]/g, sender.department)
        .replace(/\[Kontak\]/g, sender.contact || '');

    const safeEventName = sanitizeHtml(eventName);
    const safeEventDate = sanitizeHtml(eventDate);
    const safeRecipientName = sanitizeHtml(recipientName);
    const safeSenderName = sanitizeHtml(sender.name);
    const safeSenderDepartment = sanitizeHtml(sender.department);
    const safeSenderContact = sanitizeHtml(sender.contact || '');
    const hasCustomCaption = personalizedCaption.trim().length > 0;
    const captionContainsYoutubeUrl = !!youtubeUrl && personalizedCaption.includes(youtubeUrl);

    const formatCaptionParagraphs = (text: string): string => {
        const normalized = text.replace(/\r\n/g, '\n').trim();
        if (!normalized) {
            return '';
        }

        let paragraphs: string[] = [];

        if (normalized.includes('\n')) {
            paragraphs = normalized
                .split(/\n{2,}/)
                .map((block) => block.trim())
                .filter(Boolean);
        } else {
            const sentences = normalized
                .split(/(?<=[.!?])\s+(?=[A-Z0-9\[])/)
                .map((sentence) => sentence.trim())
                .filter(Boolean);

            const grouped: string[] = [];
            let buffer: string[] = [];

            for (const sentence of sentences) {
                buffer.push(sentence);
                if (buffer.length === 2) {
                    grouped.push(buffer.join(' '));
                    buffer = [];
                }
            }

            if (buffer.length > 0) {
                grouped.push(buffer.join(' '));
            }

            paragraphs = grouped.length > 0 ? grouped : [normalized];
        }

        return paragraphs
            .map((paragraph) => `<p style="margin-bottom: 14px; white-space: normal;">${sanitizeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
            .join('\n');
    };

    const formattedCaptionHtml = formatCaptionParagraphs(personalizedCaption);

    const defaultBodyHtml = `
    <p style="margin-bottom: 16px;">Yth. Bapak/Ibu <strong>${safeRecipientName}</strong>,</p>

    <p style="margin-bottom: 16px;">Salam hangat,</p>

    <p style="margin-bottom: 16px;">
        Kami dari Panitia <strong>${safeEventName}</strong> mengucapkan terima kasih yang sebesar-besarnya atas partisipasi Anda dalam acara kami yang telah dilaksanakan pada hari <strong>${safeEventDate}</strong>.
    </p>

    <p style="margin-bottom: 16px;">
        Kehadiran Bapak/Ibu sangat berarti dalam mendukung keberhasilan kegiatan ini. Semoga materi yang diperoleh bermanfaat dan mendukung peningkatan produktivitas kerja.
    </p>
`;

    const customBodyHtml = `
    ${formattedCaptionHtml}
    ${youtubeUrl && !captionContainsYoutubeUrl
            ? `<p style="margin-bottom: 16px;">Siaran ulang webinar dapat diakses di sini:<br><a href="${youtubeUrl}" style="color: #2563eb; text-decoration: underline;">${youtubeUrl}</a></p>`
            : ''}
`;

    const standardBodyHtml = `
    ${defaultBodyHtml}

    <p style="margin-bottom: 16px;">
        Sebagai bentuk apresiasi, bersama dengan email ini kami lampirkan <strong>e-sertifikat</strong> sebagai bukti keikutsertaan Anda.
    </p>

    <p style="margin-bottom: 16px;">
        Semoga ilmu dan wawasan yang dibagikan oleh para narasumber dapat bermanfaat dalam mendukung tugas dan fungsi Bapak/Ibu.${youtubeUrl ? ` Apabila Anda ingin menyaksikan kembali acara tersebut, siaran ulang dapat diakses melalui tautan berikut:<br><a href="${youtubeUrl}" style="color: #2563eb; text-decoration: underline;">${youtubeUrl}</a>` : ''}
    </p>

    <p style="margin-bottom: 16px;">
        Nantikan informasi mengenai webinar dan acara inspiratif kami selanjutnya. Sampai jumpa di lain kesempatan!
    </p>

    <p style="margin-bottom: 8px;">Hormat kami,</p>

    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
        <p style="margin: 0; font-weight: bold;">${safeSenderName}</p>
        <p style="margin: 4px 0; color: #555;">${safeSenderDepartment}</p>
        ${safeSenderContact ? `<p style="margin: 4px 0; color: #555;">${safeSenderContact}</p>` : ''}
    </div>
`;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.8; color: #333; max-width: 650px; margin: 0 auto; padding: 20px;">
    ${hasCustomCaption ? customBodyHtml : standardBodyHtml}
</body>
</html>
`;

    return {
        subject: `E-Sertifikat: ${eventName}`,
        html,
    };
}

async function ensureAuthenticatedUser() {
    const session = await auth();
    if (!session?.user) {
        throw new Error('Unauthorized: Please login first');
    }

    return session.user;
}

function validatePreviewInput({
    recipient,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: {
    recipient: { name: string; email: string };
    caption: string;
    eventName: string;
    eventDate: string;
    sender: { name: string; department: string; contact: string };
    youtubeUrl?: string;
}) {
    const recipientValidation = recipientSchema.safeParse(recipient);
    if (!recipientValidation.success) {
        throw new Error('Data penerima tidak valid untuk preview');
    }

    const senderValidation = senderSchema.safeParse(sender);
    if (!senderValidation.success) {
        throw new Error('Data pengirim tidak valid untuk preview');
    }

    if (!eventName?.trim() || !eventDate?.trim()) {
        throw new Error('Event name dan event date wajib diisi untuk preview');
    }

    if (caption.length > 10000) {
        throw new Error('Caption terlalu panjang untuk preview');
    }

    if (youtubeUrl && !isValidYoutubeUrl(youtubeUrl)) {
        throw new Error('Invalid YouTube URL. Only youtube.com and youtu.be URLs are allowed.');
    }
}

export async function analyzeCertificateAction(formData: FormData) {
    // Check authentication
    const session = await auth();
    if (!session?.user) {
        throw new Error('Unauthorized: Please login first');
    }

    const file = formData.get('certificate') as File;
    if (!file) throw new Error('No certificate file provided');

    // Rate limit check
    const rateLimitResult = checkRateLimit(session.user.id || session.user.email || 'anonymous', RATE_LIMITS.analyze);
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.message || 'Rate limit exceeded');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const aiResult = await analyzeCertificate(buffer);

    return aiResult;
}

export async function sendBroadcastAction({
    recipients,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: {
    recipients: { name: string; email: string; certBuffer: number[] }[];
    caption: string;
    eventName: string;
    eventDate: string;
    sender: { name: string; department: string; contact: string };
    youtubeUrl?: string;
}) {
    const user = await ensureAuthenticatedUser();

    const emailProvider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
    const gmailSafeDailyLimit = parseInt(process.env.GMAIL_DAILY_SAFE_LIMIT || '450', 10);

    if (emailProvider === 'gmail' && recipients.length > gmailSafeDailyLimit) {
        throw new Error(
            `Jumlah penerima (${recipients.length}) melebihi batas aman Gmail per batch (${gmailSafeDailyLimit}). ` +
            'Silakan kirim bertahap (mis. 300-450 per hari) untuk menghindari suspend/limit Gmail.',
        );
    }

    // Rate limit check
    const rateLimitResult = checkRateLimit(user.id || user.email || 'anonymous', RATE_LIMITS.broadcast);
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.message || 'Rate limit exceeded. Max 5 broadcasts per hour.');
    }

    // Validate input
    const validationResult = broadcastInputSchema.safeParse({
        recipients,
        caption,
        eventName,
        eventDate,
        sender,
        youtubeUrl,
    });

    if (!validationResult.success) {
        const errorMessages = validationResult.error.issues.map((e: { message: string }) => e.message).join(', ');
        throw new Error(`Validation failed: ${errorMessages}`);
    }

    // Validate YouTube URL if provided
    if (youtubeUrl && !isValidYoutubeUrl(youtubeUrl)) {
        throw new Error('Invalid YouTube URL. Only youtube.com and youtu.be URLs are allowed.');
    }

    const safeEventName = sanitizeHtml(eventName);
    const safeEventDate = sanitizeHtml(eventDate);

    // Create Broadcast Session
    const broadcast = await prisma.broadcast.create({
        data: {
            eventName: safeEventName,
            eventDate: safeEventDate,
            caption,
            certificate: Buffer.from(recipients[0].certBuffer),
        },
    });

    const results = [];

    for (const recipient of recipients) {
        const { subject, html } = buildEmailTemplate({
            recipientName: recipient.name,
            caption,
            eventName,
            eventDate,
            sender,
            youtubeUrl,
        });

        try {
            await sendCertificateEmail({
                to: recipient.email,
                subject,
                html,
                attachments: [
                    {
                        filename: `Sertifikat_${recipient.name.replace(/\s+/g, '_')}.pdf`,
                        content: Buffer.from(recipient.certBuffer),
                    },
                ],
            });

            // Log Success
            await prisma.recipient.create({
                data: {
                    name: recipient.name,
                    email: recipient.email,
                    status: 'success',
                    broadcastId: broadcast.id,
                },
            });

            results.push({ email: recipient.email, status: 'success' });
        } catch (error) {
            console.error(`Failed to send to ${recipient.email}:`, error);

            // Log Failure
            await prisma.recipient.create({
                data: {
                    name: recipient.name,
                    email: recipient.email,
                    status: 'failed',
                    broadcastId: broadcast.id,
                },
            });

            results.push({ email: recipient.email, status: 'failed' });
        }

        // Add delay between emails to avoid rate limiting
        if (recipients.indexOf(recipient) < recipients.length - 1) {
            await delay(getEmailDelay());
        }
    }

    return results;
}

export async function generateEmailPreviewAction({
    recipient,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: {
    recipient: { name: string; email: string };
    caption: string;
    eventName: string;
    eventDate: string;
    sender: { name: string; department: string; contact: string };
    youtubeUrl?: string;
}) {
    await ensureAuthenticatedUser();

    validatePreviewInput({ recipient, caption, eventName, eventDate, sender, youtubeUrl });

    return buildEmailTemplate({
        recipientName: recipient.name,
        caption,
        eventName,
        eventDate,
        sender,
        youtubeUrl,
    });
}

export async function sendTestEmailAction({
    recipient,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: {
    recipient: { name: string; email: string };
    caption: string;
    eventName: string;
    eventDate: string;
    sender: { name: string; department: string; contact: string };
    youtubeUrl?: string;
}) {
    const user = await ensureAuthenticatedUser();

    validatePreviewInput({ recipient, caption, eventName, eventDate, sender, youtubeUrl });

    const rateLimitResult = checkRateLimit(user.id || user.email || 'anonymous', RATE_LIMITS.analyze);
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.message || 'Rate limit exceeded');
    }

    const { subject, html } = buildEmailTemplate({
        recipientName: recipient.name,
        caption,
        eventName,
        eventDate,
        sender,
        youtubeUrl,
    });

    if (!user.email) {
        throw new Error('User email tidak ditemukan untuk kirim test email');
    }

    await sendCertificateEmail({
        to: user.email,
        subject: `[TEST] ${subject}`,
        html,
    });

    return { sentTo: user.email };
}
