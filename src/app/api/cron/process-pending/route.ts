import { NextResponse } from 'next/server';

import prisma from '@/lib/prisma';
import { sendCertificateEmail } from '@/lib/email';

const GMAIL_SAFE_DAILY_LIMIT_DEFAULT = 450;
const PENDING_RETRY_DELAY_MINUTES_DEFAULT = 30;
const PENDING_MAX_RETRY_DEFAULT = 3;

function getSafeDailyLimit() {
    const parsed = parseInt(process.env.GMAIL_DAILY_SAFE_LIMIT || `${GMAIL_SAFE_DAILY_LIMIT_DEFAULT}`, 10);
    return Number.isNaN(parsed) || parsed < 1 ? GMAIL_SAFE_DAILY_LIMIT_DEFAULT : parsed;
}

function getRetryDelayMinutes() {
    const parsed = parseInt(process.env.PENDING_RETRY_DELAY_MINUTES || `${PENDING_RETRY_DELAY_MINUTES_DEFAULT}`, 10);
    return Number.isNaN(parsed) || parsed < 1 ? PENDING_RETRY_DELAY_MINUTES_DEFAULT : parsed;
}

function getMaxRetries() {
    const parsed = parseInt(process.env.PENDING_MAX_RETRY || `${PENDING_MAX_RETRY_DEFAULT}`, 10);
    return Number.isNaN(parsed) || parsed < 1 ? PENDING_MAX_RETRY_DEFAULT : parsed;
}

function isAuthorized(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return false;
    }

    const url = new URL(request.url);
    const querySecret = url.searchParams.get('secret');
    const headerSecret = request.headers.get('x-cron-secret');

    return querySecret === secret || headerSecret === secret;
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if ((process.env.EMAIL_PROVIDER || 'gmail').toLowerCase() !== 'gmail') {
        return NextResponse.json({ processed: 0, sent: 0, failed: 0, message: 'Skipped: EMAIL_PROVIDER is not gmail' });
    }

    const now = new Date();
    const safeDailyLimit = getSafeDailyLimit();
    const retryDelayMinutes = getRetryDelayMinutes();
    const maxRetry = getMaxRetries();

    const pendingEmails = await prisma.pendingEmail.findMany({
        where: {
            status: 'pending',
            scheduledFor: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
        take: safeDailyLimit,
    });

    let sent = 0;
    let failed = 0;

    for (const pending of pendingEmails) {
        try {
            await sendCertificateEmail({
                to: pending.email,
                subject: pending.subject,
                html: pending.html,
                attachments: [
                    {
                        filename: pending.certificateFilename,
                        content: Buffer.from(pending.certificate),
                    },
                ],
            });

            await prisma.pendingEmail.update({
                where: { id: pending.id },
                data: {
                    status: 'sent',
                    sentAt: new Date(),
                    attempts: { increment: 1 },
                    lastError: null,
                },
            });

            await prisma.recipient.updateMany({
                where: {
                    broadcastId: pending.broadcastId,
                    email: pending.email,
                    status: 'pending',
                },
                data: {
                    status: 'success',
                    sentAt: new Date(),
                },
            });

            sent++;
        } catch (error) {
            failed++;
            const nextAttempt = pending.attempts + 1;
            const shouldMarkFailed = nextAttempt >= maxRetry;

            await prisma.pendingEmail.update({
                where: { id: pending.id },
                data: {
                    attempts: nextAttempt,
                    lastError: error instanceof Error ? error.message : 'Unknown error',
                    status: shouldMarkFailed ? 'failed' : 'pending',
                    scheduledFor: shouldMarkFailed
                        ? pending.scheduledFor
                        : new Date(Date.now() + retryDelayMinutes * 60 * 1000),
                },
            });

            if (shouldMarkFailed) {
                await prisma.recipient.updateMany({
                    where: {
                        broadcastId: pending.broadcastId,
                        email: pending.email,
                        status: 'pending',
                    },
                    data: {
                        status: 'failed',
                    },
                });
            }
        }
    }

    return NextResponse.json({
        processed: pendingEmails.length,
        sent,
        failed,
    });
}
