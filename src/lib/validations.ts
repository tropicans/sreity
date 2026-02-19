import { z } from 'zod';

// Recipient validation
export const recipientSchema = z.object({
    name: z.string()
        .min(1, 'Nama harus diisi')
        .max(100, 'Nama terlalu panjang')
        .transform(val => val.trim()),
    email: z.string()
        .email('Format email tidak valid')
        .max(255, 'Email terlalu panjang')
        .transform(val => val.trim().toLowerCase()),
});

export const recipientsArraySchema = z.array(recipientSchema)
    .min(1, 'Minimal satu penerima diperlukan')
    .max(500, 'Maksimal 500 penerima per broadcast');

// Sender profile validation
export const senderSchema = z.object({
    name: z.string()
        .min(1, 'Nama pengirim harus diisi')
        .max(100, 'Nama pengirim terlalu panjang')
        .transform(val => val.trim()),
    department: z.string()
        .min(1, 'Departemen/unit harus diisi')
        .max(100, 'Departemen terlalu panjang')
        .transform(val => val.trim()),
    contact: z.string()
        .max(100, 'Kontak terlalu panjang')
        .transform(val => val.trim())
        .optional()
        .default(''),
});

// Broadcast action validation
export const broadcastInputSchema = z.object({
    recipients: z.array(z.object({
        name: z.string().min(1).max(100),
        email: z.string().min(1).max(255),
        certBuffer: z.array(z.number()).optional(),
    })).min(1).max(5000),
    defaultCertBuffer: z.array(z.number()).optional(),
    caption: z.string()
        .max(10000, 'Caption terlalu panjang'),
    eventName: z.string()
        .min(1, 'Nama event harus diisi')
        .max(200, 'Nama event terlalu panjang'),
    eventDate: z.string()
        .min(1, 'Tanggal event harus diisi')
        .max(100, 'Format tanggal tidak valid'),
    sender: senderSchema,
    youtubeUrl: z.string()
        .url('Format URL tidak valid')
        .optional()
        .or(z.literal('')),
});

// Google Drive folder ID validation
export const drivefolderIdSchema = z.string()
    .min(10, 'Folder ID terlalu pendek')
    .max(100, 'Folder ID terlalu panjang')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Format Folder ID tidak valid');

// Sanitize HTML to prevent XSS
export function sanitizeHtml(input: string): string {
    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Safe URL validation for YouTube
export function isValidYoutubeUrl(url: string): boolean {
    if (!url) return true;
    try {
        const parsed = new URL(url);
        return ['youtube.com', 'www.youtube.com', 'youtu.be'].includes(parsed.hostname);
    } catch {
        return false;
    }
}
