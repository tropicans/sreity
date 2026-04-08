import OpenAI from 'openai';

const OPENAI_ANALYZE_FALLBACK_MODELS = ['claude-sonnet-4-6'];
const GEMINI_ANALYZE_FALLBACK_MODELS = ['gemini-2.5-flash'];

const ANALYSIS_PROMPT = `You are extracting structured event data from an uploaded image for a certificate-broadcast email.

The input image may be a certificate, webinar poster, flyer, or event visual.
Your primary job is accurate OCR extraction.

Extraction procedure:
1. Read all prominent text on the image carefully.
2. Identify the actual event title from the main headline, not from speaker names, contact info, institution names, YouTube links, or slogans.
3. Identify the event date/time block exactly as written on the image.
4. Only fill recipientName if the image clearly shows a participant/recipient name.

Rules:
1. recipientName: copy the participant/recipient full name exactly as written only if the image clearly contains a participant name.
2. Do NOT use speaker names, moderator names, contact names, or institution names as recipientName.
3. eventName: combine the event series and the main title when both are part of the visible headline.
4. eventDate: copy the schedule/date text exactly as written on the image. If there is a time range, include it.
5. caption: write a warm professional email caption in Indonesian for sending the participation certificate after the event has taken place.
6. Use ONLY [Nama] as the recipient placeholder in the caption. Never use the extracted recipientName directly inside the caption.
7. The caption should sound like a certificate delivery email, not an invitation poster.
8. Do NOT invent organization names, sender names, or contact info.
9. If a field is unclear, return an empty string instead of guessing.

For webinar posters like this, eventName should usually come from the largest central title plus its webinar series label, and eventDate should come from the date/time block.

Return only valid JSON with this shape:
{
  "recipientName": "...",
  "eventName": "...",
  "eventDate": "...",
  "caption": "..."
}`;

function getOpenAiConfig() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const baseURL = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o';

    if (!apiKey) {
        throw new Error('Konfigurasi AI belum lengkap: OPENAI_API_KEY belum diisi.');
    }

    let parsedBaseUrl: URL;
    try {
        parsedBaseUrl = new URL(baseURL);
    } catch {
        throw new Error(`Konfigurasi AI tidak valid: OPENAI_BASE_URL (${baseURL}) bukan URL yang valid.`);
    }

    if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
        throw new Error(`Konfigurasi AI tidak valid: OPENAI_BASE_URL (${baseURL}) harus memakai http atau https.`);
    }

    return { apiKey, baseURL, model };
}

function getOpenAiClient() {
    const { apiKey, baseURL } = getOpenAiConfig();
    return new OpenAI({
        apiKey,
        baseURL,
    });
}

function getGeminiConfig() {
    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
    const model = process.env.GEMINI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gemini-2.5-flash';

    if (!apiKey) {
        throw new Error('Konfigurasi AI belum lengkap: GEMINI_API_KEY atau OPENAI_API_KEY belum diisi.');
    }

    return { apiKey, model };
}

function shouldUseDirectGemini(model: string) {
    return Boolean(process.env.GEMINI_API_KEY?.trim()) || model.startsWith('gemini-');
}

function cleanAiText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function buildFallbackCaption(eventName: string, eventDate: string): string {
    const safeEventName = eventName || '[Nama Kegiatan]';
    const safeEventDate = eventDate || '[Tanggal Kegiatan]';

    return `Yth. Bapak/Ibu [Nama],

Salam hangat.

Dengan ini kami menyampaikan sertifikat keikutsertaan Anda pada kegiatan "${safeEventName}" yang telah dilaksanakan pada ${safeEventDate}. Terima kasih atas partisipasi dan perhatian Anda selama sesi berlangsung.

Semoga pengetahuan yang diperoleh bermanfaat untuk mendukung kinerja dan pengembangan kompetensi.`;
}

function normalizeAnalysisResult(payload: unknown) {
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const recipientName = cleanAiText(data.recipientName);
    const eventName = cleanAiText(data.eventName);
    const eventDate = cleanAiText(data.eventDate);
    const caption = cleanAiText(data.caption) || buildFallbackCaption(eventName, eventDate);

    return {
        recipientName,
        eventName,
        eventDate,
        caption,
    };
}

function extractJsonText(content: unknown): string {
    if (typeof content === 'string') {
        return content.trim();
    }

    if (Array.isArray(content)) {
        const textParts = content
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
                    return item.text;
                }

                return '';
            })
            .filter(Boolean);

        return textParts.join('\n').trim();
    }

    return '';
}

function stripJsonMarkdown(text: string) {
    return text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
}

function extractGeminiText(payload: unknown): string {
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const firstCandidate = candidates[0] as Record<string, unknown> | undefined;
    const content = firstCandidate?.content;
    const parts = content && typeof content === 'object' && Array.isArray((content as Record<string, unknown>).parts)
        ? (content as Record<string, unknown>).parts as Array<Record<string, unknown>>
        : [];

    return parts
        .map((part) => typeof part.text === 'string' ? part.text : '')
        .filter(Boolean)
        .join('\n')
        .trim();
}

async function analyzeWithDirectGemini(base64Image: string, mimeType: string) {
    const { apiKey, model } = getGeminiConfig();
    const candidateModels = [model, ...GEMINI_ANALYZE_FALLBACK_MODELS.filter((fallback) => fallback !== model)];
    let lastError = '';

    for (const candidateModel of candidateModels) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: ANALYSIS_PROMPT },
                            {
                                inlineData: {
                                    mimeType,
                                    data: base64Image,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                },
            }),
        });

        const rawText = await response.text();
        const payload = rawText ? JSON.parse(rawText) : {};

        if (!response.ok) {
            const message = payload?.error?.message || rawText || `HTTP ${response.status}`;
            lastError = message;

            if (response.status === 429 && candidateModel !== candidateModels[candidateModels.length - 1]) {
                continue;
            }

            throw new Error(message);
        }

        const content = stripJsonMarkdown(extractGeminiText(payload));
        if (!content) {
            lastError = `Model ${candidateModel} tidak mengembalikan teks.`;
            continue;
        }

        return normalizeAnalysisResult(JSON.parse(content));
    }

    throw new Error(lastError || `Model Gemini tidak mengembalikan hasil. Coba ganti OPENAI_MODEL/GEMINI_MODEL ke ${GEMINI_ANALYZE_FALLBACK_MODELS[0]}.`);
}

async function analyzeWithOpenAiCompatible(base64Image: string, mimeType: string) {
    const { model } = getOpenAiConfig();
    const openai = getOpenAiClient();
    const candidateModels = [model, ...OPENAI_ANALYZE_FALLBACK_MODELS.filter((fallback) => fallback !== model)];
    let lastEmptyModel: string | null = null;

    for (const candidateModel of candidateModels) {
        const response = await openai.chat.completions.create({
            model: candidateModel,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: ANALYSIS_PROMPT,
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64Image}`,
                                detail: 'high',
                            },
                        },
                    ],
                },
            ],
            response_format: { type: 'json_object' },
        });

        const content = stripJsonMarkdown(extractJsonText(response.choices[0]?.message?.content));
        if (!content) {
            lastEmptyModel = candidateModel;
            continue;
        }

        return normalizeAnalysisResult(JSON.parse(content));
    }

    throw new Error(`Model AI tidak mengembalikan isi respons. Coba ganti OPENAI_MODEL dari ${lastEmptyModel || model} ke claude-sonnet-4-6.`);
}

export async function analyzeCertificate(imageBuffer: Buffer, mimeType = 'image/png') {
    const base64Image = imageBuffer.toString('base64');

    try {
        const preferredModel = process.env.GEMINI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || '';
        if (shouldUseDirectGemini(preferredModel)) {
            return await analyzeWithDirectGemini(base64Image, mimeType);
        }

        return await analyzeWithOpenAiCompatible(base64Image, mimeType);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const lower = message.toLowerCase();

        if (lower.includes('incorrect api key') || lower.includes('invalid_api_key') || lower.includes('unauthorized') || lower.includes('api key not valid')) {
            throw new Error('Autentikasi AI gagal. Cek GEMINI_API_KEY/OPENAI_API_KEY yang aktif di environment.');
        }

        if (lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('unsupported'))) {
            const activeModel = process.env.GEMINI_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || '';
            throw new Error(`Model AI tidak tersedia. Cek GEMINI_MODEL/OPENAI_MODEL (${activeModel}) di environment.`);
        }

        if (lower.includes('quota exceeded') || lower.includes('resource_exhausted')) {
            throw new Error('Kuota Gemini habis atau model tidak tersedia untuk paket API key saat ini. Coba gunakan model Gemini lain seperti gemini-2.5-flash.');
        }

        if (lower.includes('base url') || lower.includes('fetch failed') || lower.includes('enotfound') || lower.includes('econnrefused')) {
            const activeBaseUrl = process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
            throw new Error(`Koneksi ke AI gagal. Cek OPENAI_BASE_URL (${activeBaseUrl}).`);
        }

        throw new Error(`Analisis AI gagal: ${message}`);
    }
}
