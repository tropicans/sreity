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

const GMAIL_SAFE_DAILY_LIMIT_DEFAULT = 450;
const GMAIL_PENDING_DELAY_HOURS_DEFAULT = 24;
const GMAIL_IMMEDIATE_BATCH_LIMIT_DEFAULT = 20;

function normalizeCaption(text: string): string {
    const rawNormalized = text.replace(/\r\n/g, '\n').trim();
    if (!rawNormalized) {
        return '';
    }

    const duplicatedWholeText = rawNormalized.match(/^([\s\S]{40,}?)\s+\1$/);
    if (duplicatedWholeText) {
        return duplicatedWholeText[1]
            .trim()
            .replace(/([.!?])\s+(?=(salam\s+hormat|hormat\s+kami|hormat\s+saya)\b)/gi, '$1\n\n');
    }

    const paragraphs = rawNormalized
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (paragraphs.length >= 4 && paragraphs.length % 2 === 0) {
        const half = paragraphs.length / 2;
        const firstHalf = paragraphs.slice(0, half);
        const secondHalf = paragraphs.slice(half);
        const isDuplicated = firstHalf.every((part, index) => part === secondHalf[index]);
        if (isDuplicated) {
            return firstHalf
                .join('\n\n')
                .replace(/([.!?])\s+(?=(salam\s+hormat|hormat\s+kami|hormat\s+saya)\b)/gi, '$1\n\n');
        }
    }

    return rawNormalized.replace(/([.!?])\s+(?=(salam\s+hormat|hormat\s+kami|hormat\s+saya)\b)/gi, '$1\n\n');
}

function buildYoutubeLinkHtml(youtubeUrl?: string): string {
    if (!youtubeUrl) {
        return '';
    }

    const getYoutubeVideoId = (url: string): string | null => {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();

            if (host === 'youtu.be') {
                const id = parsed.pathname.split('/').filter(Boolean)[0];
                return id || null;
            }

            if (host === 'youtube.com' || host === 'www.youtube.com') {
                return parsed.searchParams.get('v');
            }
        } catch {
            return null;
        }

        return null;
    };

    const videoId = getYoutubeVideoId(youtubeUrl);
    const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '';

    if (!thumbnailUrl) {
        return `<p style="margin-bottom: 16px;">Siaran ulang webinar dapat diakses di sini:<br><a href="${youtubeUrl}" style="color: #2563eb; text-decoration: underline;">${youtubeUrl}</a></p>`;
    }

    return `
    <div style="margin: 18px 0 20px; padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f8fafc;">
        <a href="${youtubeUrl}" style="display: block; text-decoration: none; color: inherit;">
            <img src="${thumbnailUrl}" alt="Siaran ulang webinar" style="display: block; width: 100%; max-width: 560px; border-radius: 10px; border: 1px solid #d1d5db; margin: 0 auto;" />
        </a>
        <div style="margin-top: 12px; text-align: center;">
            <a href="${youtubeUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;">Buka Siaran Ulang</a>
        </div>
        <p style="margin: 10px 0 0; color: #2563eb; font-size: 12px; text-decoration: underline; word-break: break-all; text-align: center;">${youtubeUrl}</p>
    </div>`;
}

function splitCaptionClosing(text: string): { bodyText: string; closingText: string } {
    const closingPattern = /(?:^|\n{2,})(salam\s+hormat|hormat\s+kami|hormat\s+saya)\b[\s\S]*$/i;
    const match = text.match(closingPattern);
    if (!match || typeof match.index !== 'number') {
        return { bodyText: text, closingText: '' };
    }

    const index = match.index;
    if (index < text.length * 0.35) {
        return { bodyText: text, closingText: '' };
    }

    return {
        bodyText: text.slice(0, index).trim(),
        closingText: text.slice(index).trim(),
    };
}

function formatClosingHtml(closingText: string, senderName?: string, senderContact?: string): string {
    if (!closingText) {
        return '';
    }

    const name = (senderName || '').trim();
    const contact = (senderContact || '').trim();
    const normalizedClosing = closingText.toLowerCase().replace(/\s+/g, '');
    const normalizedName = name.toLowerCase().replace(/\s+/g, '');
    const normalizedContact = contact.toLowerCase().replace(/\s+/g, '');
    const hasNameInClosing = !!name && normalizedClosing.includes(normalizedName);
    const hasContactInClosing = !!contact && normalizedClosing.includes(normalizedContact);

    const normalized = closingText
        .replace(/\r\n/g, '\n')
        .replace(/,\s+/g, ',\n')
        .replace(/(.+?)\s+(\+?\d[\d\s-]{7,})$/, '$1\n$2')
        .trim();

    const withName = !hasNameInClosing && name
        ? `${normalized}\n${name}`
        : normalized;

    const withContact = !hasContactInClosing && contact
        ? `${withName}\n${contact}`
        : withName;

    const safeClosing = sanitizeHtml(withContact).replace(/\n/g, '<br/>');

    return `
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
        <p style="margin: 0; color: #333;">${safeClosing}</p>
    </div>`;
}

function buildEmailTemplate({
    recipientName,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: EmailTemplateInput): { subject: string; html: string } {
    let personalizedCaptionRaw = caption
        .replace(/\[Nama\]/g, recipientName)
        .replace(/\[Nama Pengirim\]/g, sender.name)
        .replace(/\[Nama Penyelenggara\/Tim\]/g, sender.name)
        .replace(/\[Tim Penyelenggara\]/g, sender.name)
        .replace(/\[Nama Instansi\/Tim Penyelenggara\]/g, sender.department || sender.name)
        .replace(/\[Nama Penyelenggara\/Instansi\]/g, sender.name)
        .replace(/\[Nama Instansi\]/g, sender.department || sender.name)
        .replace(/\[Panitia\/Instansi\]/g, sender.name)
        .replace(/\[Panitia\/Institusi\]/g, sender.name)
        .replace(/\[Panitia\]/g, sender.name)
        .replace(/\[Instansi\]/g, sender.department || sender.name)
        .replace(/\[Instansi\/Unit\]/g, sender.department)
        .replace(/\[Kontak\]/g, sender.contact || '');

    // Safety net: strip any remaining [...] placeholders the AI may have invented
    personalizedCaptionRaw = personalizedCaptionRaw.replace(/\[[^\]]{2,40}\]/g, '').replace(/\s{2,}/g, ' ').trim();

    const personalizedCaption = normalizeCaption(personalizedCaptionRaw);

    const safeEventName = sanitizeHtml(eventName);
    const safeEventDate = sanitizeHtml(eventDate);
    const safeRecipientName = sanitizeHtml(recipientName);
    const safeSenderName = sanitizeHtml(sender.name);
    const safeSenderDepartment = sanitizeHtml(sender.department);
    const safeSenderContact = sanitizeHtml(sender.contact || '');
    const hasCustomCaption = personalizedCaption.trim().length > 0;
    const captionContainsYoutubeUrl = !!youtubeUrl && personalizedCaption.includes(youtubeUrl);
    const captionHasClosing = /\b(hormat\s+kami|salam\s+hormat|hormat\s+saya)\b/i.test(personalizedCaption);
    const youtubeLinkHtml = buildYoutubeLinkHtml(youtubeUrl);
    const { bodyText: customCaptionBody, closingText: customCaptionClosing } = splitCaptionClosing(personalizedCaption);

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

    const formattedCaptionHtml = formatCaptionParagraphs(customCaptionBody);
    const formattedCustomClosingHtml = formatClosingHtml(customCaptionClosing, sender.name, sender.contact);

    const signatureFooterHtml = `
    <p style="margin-bottom: 8px;">Hormat kami,</p>

    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
        <p style="margin: 0; font-weight: bold;">${safeSenderName}</p>
        <p style="margin: 4px 0; color: #555;">${safeSenderDepartment}</p>
        ${safeSenderContact ? `<p style="margin: 4px 0; color: #555;">${safeSenderContact}</p>` : ''}
    </div>
`;

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
    ${youtubeUrl && !captionContainsYoutubeUrl ? youtubeLinkHtml : ''}
    ${formattedCustomClosingHtml || (captionHasClosing ? '' : signatureFooterHtml)}
`;

    const standardBodyHtml = `
    ${defaultBodyHtml}

    <p style="margin-bottom: 16px;">
        Sebagai bentuk apresiasi, bersama dengan email ini kami lampirkan <strong>e-sertifikat</strong> sebagai bukti keikutsertaan Anda.
    </p>

    <p style="margin-bottom: 16px;">
        Semoga ilmu dan wawasan yang dibagikan oleh para narasumber dapat bermanfaat dalam mendukung tugas dan fungsi Bapak/Ibu.
    </p>

    <p style="margin-bottom: 16px;">
        Nantikan informasi mengenai webinar dan acara inspiratif kami selanjutnya. Sampai jumpa di lain kesempatan!
    </p>

    ${youtubeLinkHtml}

    ${signatureFooterHtml}
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

function getGmailSafeDailyLimit() {
    const parsed = parseInt(process.env.GMAIL_DAILY_SAFE_LIMIT || `${GMAIL_SAFE_DAILY_LIMIT_DEFAULT}`, 10);
    return Number.isNaN(parsed) || parsed < 1 ? GMAIL_SAFE_DAILY_LIMIT_DEFAULT : parsed;
}

function getPendingDelayHours() {
    const parsed = parseInt(process.env.GMAIL_PENDING_DELAY_HOURS || `${GMAIL_PENDING_DELAY_HOURS_DEFAULT}`, 10);
    return Number.isNaN(parsed) || parsed < 1 ? GMAIL_PENDING_DELAY_HOURS_DEFAULT : parsed;
}

function getImmediateBatchLimit() {
    const parsed = parseInt(process.env.GMAIL_IMMEDIATE_BATCH_LIMIT || `${GMAIL_IMMEDIATE_BATCH_LIMIT_DEFAULT}`, 10);
    return Number.isNaN(parsed) || parsed < 1 ? GMAIL_IMMEDIATE_BATCH_LIMIT_DEFAULT : parsed;
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
    defaultCertBuffer,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: {
    recipients: { name: string; email: string; certBuffer?: number[] }[];
    defaultCertBuffer?: number[];
    caption: string;
    eventName: string;
    eventDate: string;
    sender: { name: string; department: string; contact: string };
    youtubeUrl?: string;
}) {
    const user = await ensureAuthenticatedUser();

    const emailProvider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
    const gmailSafeDailyLimit = getGmailSafeDailyLimit();

    // Rate limit check
    const rateLimitResult = checkRateLimit(user.id || user.email || 'anonymous', RATE_LIMITS.broadcast);
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.message || 'Rate limit exceeded. Max 5 broadcasts per hour.');
    }

    // Validate input
    const validationResult = broadcastInputSchema.safeParse({
        recipients,
        defaultCertBuffer,
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
    const firstAvailableCertificate = recipients.find((recipient) => recipient.certBuffer && recipient.certBuffer.length > 0)?.certBuffer
        || defaultCertBuffer;

    if (!firstAvailableCertificate || firstAvailableCertificate.length === 0) {
        throw new Error('Sertifikat tidak ditemukan. Upload file sertifikat default atau pastikan tiap penerima punya sertifikat.');
    }

    const broadcast = await prisma.broadcast.create({
        data: {
            eventName: safeEventName,
            eventDate: safeEventDate,
            caption,
            certificate: Buffer.from(firstAvailableCertificate),
        },
    });

    const results = [];

    const immediateBatchLimit = getImmediateBatchLimit();
    const immediateSendCount = Math.min(gmailSafeDailyLimit, immediateBatchLimit);

    const immediateRecipients = emailProvider === 'gmail'
        ? recipients.slice(0, immediateSendCount)
        : recipients;
    const pendingRecipients = emailProvider === 'gmail'
        ? recipients.slice(immediateSendCount)
        : [];

    if (pendingRecipients.length > 0) {
        const scheduledFor = new Date(Date.now() + getPendingDelayHours() * 60 * 60 * 1000);

        const pendingEmailRows = pendingRecipients.map((recipient) => {
            const { subject, html } = buildEmailTemplate({
                recipientName: recipient.name,
                caption,
                eventName,
                eventDate,
                sender,
                youtubeUrl,
            });

            return {
                name: recipient.name,
                email: recipient.email,
                subject,
                html,
                certificateFilename: `Sertifikat_${recipient.name.replace(/\s+/g, '_')}.pdf`,
                certificate: Buffer.from(recipient.certBuffer && recipient.certBuffer.length > 0 ? recipient.certBuffer : firstAvailableCertificate),
                status: 'pending',
                scheduledFor,
                broadcastId: broadcast.id,
            };
        });

        await prisma.pendingEmail.createMany({
            data: pendingEmailRows,
        });

        await prisma.recipient.createMany({
            data: pendingRecipients.map((recipient) => ({
                name: recipient.name,
                email: recipient.email,
                status: 'pending',
                broadcastId: broadcast.id,
            })),
        });

        for (const recipient of pendingRecipients) {
            results.push({ email: recipient.email, status: 'pending' });
        }
    }

    for (const recipient of immediateRecipients) {
        const { subject, html } = buildEmailTemplate({
            recipientName: recipient.name,
            caption,
            eventName,
            eventDate,
            sender,
            youtubeUrl,
        });

        try {
            const certBuffer = recipient.certBuffer && recipient.certBuffer.length > 0
                ? recipient.certBuffer
                : firstAvailableCertificate;

            await sendCertificateEmail({
                to: recipient.email,
                subject,
                html,
                attachments: [
                    {
                        filename: `Sertifikat_${recipient.name.replace(/\s+/g, '_')}.pdf`,
                        content: Buffer.from(certBuffer),
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
        if (immediateRecipients.indexOf(recipient) < immediateRecipients.length - 1) {
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
    certBuffer,
    certFilename,
    caption,
    eventName,
    eventDate,
    sender,
    youtubeUrl,
}: {
    recipient: { name: string; email: string };
    certBuffer?: number[];
    certFilename?: string;
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
        attachments: certBuffer && certBuffer.length > 0
            ? [
                {
                    filename: certFilename || `Sertifikat_${recipient.name.replace(/\s+/g, '_')}.pdf`,
                    content: Buffer.from(certBuffer),
                },
            ]
            : undefined,
    });

    return { sentTo: user.email };
}
