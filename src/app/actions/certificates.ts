'use server';

import * as fs from 'fs';
import * as path from 'path';

interface CertificateMatch {
    name: string;
    email: string;
    certPath: string | null;
    certBuffer: number[] | null;
}

/**
 * Fetches certificates from a folder path and matches them to recipients.
 */
export async function fetchCertificatesFromFolder(
    folderPath: string,
    recipients: { name: string; email: string }[]
): Promise<CertificateMatch[]> {
    const results: CertificateMatch[] = [];

    try {
        // Read directory contents
        const files = fs.readdirSync(folderPath);

        for (const recipient of recipients) {
            // Normalize recipient name: lowercase and replace non-alphanumeric with underscore
            const normalizedName = recipient.name.toLowerCase().replace(/[^a-z0-9]/g, '_');

            // Find matching file
            const matchedFile = files.find(file => {
                const fileName = file.toLowerCase().replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/g, '_');
                return fileName.includes(normalizedName) || normalizedName.includes(fileName);
            });

            if (matchedFile) {
                const filePath = path.join(folderPath, matchedFile);
                const fileBuffer = fs.readFileSync(filePath);
                results.push({
                    ...recipient,
                    certPath: filePath,
                    certBuffer: Array.from(fileBuffer),
                });
            } else {
                results.push({
                    ...recipient,
                    certPath: null,
                    certBuffer: null,
                });
            }
        }
    } catch (error) {
        console.error('Error reading certificate folder:', error);
        // Return recipients with null certs if folder read fails
        return recipients.map(r => ({ ...r, certPath: null, certBuffer: null }));
    }

    return results;
}
