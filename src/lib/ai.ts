import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
});

export async function analyzeCertificate(imageBuffer: Buffer) {
    const base64Image = imageBuffer.toString('base64');

    const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Analyze this certificate image. 
            1. Extract the name of the recipient.
            2. Extract the name of the event/webinar.
            3. Extract the date of the event.
            4. Generate a warm, professional email caption for broadcasting this certificate to the recipient. 
            The caption should be in Indonesian, similar to the tone in the example: "Yth. Bapak/Ibu [Nama], Salam hangat...".
            Include placeholders like [Nama] if needed.
            
            Return the result in JSON format:
            {
              "recipientName": "...",
              "eventName": "...",
              "eventDate": "...",
              "caption": "..."
            }`,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${base64Image}`,
                        },
                    },
                ],
            },
        ],
        response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content || '{}');
}
