'use server';

import { google, drive_v3 } from 'googleapis';
import { auth } from '@/lib/auth';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

interface DriveFile {
    id: string;
    name: string;
}

interface CertificateMatch {
    name: string;
    email: string;
    fileId: string | null;
    fileName: string | null;
    certBuffer: number[] | null;
}

/**
 * Get Google Drive client using API key for public folders.
 */
function getDriveClient() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error('GOOGLE_API_KEY is not set in environment variables');
    }
    return google.drive({ version: 'v3', auth: apiKey });
}

async function ensureAuthenticated() {
    const session = await auth();
    if (!session?.user) {
        throw new Error('Unauthorized: Please login first');
    }

    return session.user.id || session.user.email || 'anonymous';
}

async function enforceDriveRateLimit(identifier: string) {
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.checkDriveMatches);
    if (!rateLimitResult.success) {
        throw new Error(rateLimitResult.message || 'Rate limit exceeded');
    }
}

/**
 * List files in a Google Drive folder.
 */
export async function listDriveFiles(folderId: string): Promise<DriveFile[]> {
    await ensureAuthenticated();
    const drive = getDriveClient();

    try {
        const allFiles: DriveFile[] = [];
        let pageToken: string | undefined = undefined;

        do {
            const response: { data: drive_v3.Schema$FileList } = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: 'nextPageToken, files(id, name)',
                pageSize: 1000,
                pageToken,
            });

            const files = (response.data.files || [])
                .filter((file: drive_v3.Schema$File) => typeof file.id === 'string' && typeof file.name === 'string')
                .map((file) => ({
                    id: file.id as string,
                    name: file.name as string,
                }));

            allFiles.push(...files);
            pageToken = response.data.nextPageToken || undefined;
        } while (pageToken);

        return allFiles;
    } catch (error) {
        console.error('Error listing Drive files:', error);
        return [];
    }
}

/**
 * Download a file from Google Drive.
 */
export async function downloadDriveFile(fileId: string): Promise<Buffer | null> {
    await ensureAuthenticated();
    const drive = getDriveClient();

    try {
        const response = await drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'arraybuffer' }
        );
        return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
        console.error('Error downloading Drive file:', error);
        return null;
    }
}

/**
 * Fetch certificates from Google Drive and match to recipients.
 */
export async function fetchCertificatesFromDrive(
    folderId: string,
    recipients: { name: string; email: string }[]
): Promise<CertificateMatch[]> {
    const identifier = await ensureAuthenticated();
    await enforceDriveRateLimit(identifier);

    const files = await listDriveFiles(folderId);
    const results: CertificateMatch[] = [];

    for (const recipient of recipients) {
        // Normalize recipient name
        const normalizedName = recipient.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

        // Find matching file
        const matchedFile = files.find(file => {
            const fileName = file.name.toLowerCase().replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/g, '_');
            return fileName.includes(normalizedName) || normalizedName.includes(fileName);
        });

        if (matchedFile) {
            results.push({
                ...recipient,
                fileId: matchedFile.id,
                fileName: matchedFile.name,
                certBuffer: null, // Will be downloaded during broadcast
            });
        } else {
            results.push({
                ...recipient,
                fileId: null,
                fileName: null,
                certBuffer: null,
            });
        }
    }

    return results;
}

/**
 * Check which recipients have matching certificates in Google Drive (preview only, no download).
 */
export async function checkDriveMatches(
    folderId: string,
    recipients: { name: string; email: string }[]
): Promise<{ name: string; email: string; matched: boolean; fileName: string | null; fileId: string | null }[]> {
    const identifier = await ensureAuthenticated();
    await enforceDriveRateLimit(identifier);

    const files = await listDriveFiles(folderId);
    const results: { name: string; email: string; matched: boolean; fileName: string | null; fileId: string | null }[] = [];

    for (const recipient of recipients) {
        // Normalize recipient name
        const normalizedName = recipient.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

        // Find matching file
        const matchedFile = files.find(file => {
            const fileName = file.name.toLowerCase().replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/g, '_');
            return fileName.includes(normalizedName) || normalizedName.includes(fileName);
        });

        results.push({
            name: recipient.name,
            email: recipient.email,
            matched: !!matchedFile,
            fileName: matchedFile?.name || null,
            fileId: matchedFile?.id || null,
        });
    }

    return results;
}

