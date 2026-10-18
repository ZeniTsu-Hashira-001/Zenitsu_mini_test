// ./commands/analyse.js

const axios = require('axios');

// ═══════════════════════════════════════
// STYLE
// ═══════════════════════════════════════

const STYLE = {
    forwardingScore: 350,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363425394543602@newsletter',
        newsletterName: '모🅒🅨🅑🅔🅡🅝🅞🅥🅐 🌟',
        serverMessageId: 202,
    },
};

// ═══════════════════════════════════════
// CONFIG & CLÉS API
// ═══════════════════════════════════════

const LIMIT_MS = 15 * 60 * 1000;
const MAX_PROVIDERS = 3;
const MIN_PROVIDERS = 2;
const TIMEOUT_PER_PROVIDER = 25000;

// Clés intégrées directement (à révoquer après test)
const GROQ_API_KEY = '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';
const GEMINI_API_KEY = 'AQ.Ab8RN6J1h2dUPCHOANCvNUVCwXXv7YumfMWrImgxE3YHYdwI2A';

const lastUsage = new Map();

// ═══════════════════════════════════════
// PROMPT SYSTÈME
// ═══════════════════════════════════════

const SYSTEM_PROMPT = `You are a professional vision analyst. Analyze the image with precision and natural language. Structure your answer exactly like this:

1. **General description** — 2-3 sentences.
2. **Visual details** — colors, composition, lighting, visible text.
3. **Context & mood** — emotion, style, era, setting.
4. **Notable elements** — people, objects, animals, logos, landmarks.

If the image contains text, transcribe it exactly.
If the image is blurry, say so honestly.
Answer in the same language as the user's question.`;

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════

function getSenderId(msg) {
    return msg.key.participant || msg.key.remoteJid;
}

function checkLimit(userId, isPro) {
    if (isPro) return { allowed: true, remaining: 0 };
    const now = Date.now();
    const last = lastUsage.get(userId) || 0;
    const elapsed = now - last;
    if (elapsed < LIMIT_MS) {
        return { allowed: false, remaining: Math.ceil((LIMIT_MS - elapsed) / 1000) };
    }
    return { allowed: true, remaining: 0 };
}

function setLimit(userId) {
    lastUsage.set(userId, Date.now());
}

setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of lastUsage) {
        if (now - ts > 2 * 60 * 60 * 1000) lastUsage.delete(key);
    }
}, 60 * 60 * 1000);

async function downloadImageFromMessage(sock, msg) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted?.imageMessage) return null;
    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return {
        base64: buffer.toString('base64'),
        mime: quoted.imageMessage.mimetype || 'image/jpeg',
    };
}

// ═══════════════════════════════════════
// PROVIDERS AVEC CLÉ (Groq, Gemini)
// ═══════════════════════════════════════

const KEYED_PROVIDERS = [
    {
        name: 'Groq',
        model: 'qwen/qwen3.6-27b',
        async analyze(imageBase64, mime, prompt) {
            const { data } = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
                            ],
                        },
                    ],
                    temperature: 0.2,
                    max_completion_tokens: 1024,
                },
                {
                    headers: {
                        Authorization: `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: TIMEOUT_PER_PROVIDER,
                }
            );
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new Error('Empty Groq response');
            return text;
        },
    },
    {
        name: 'Gemini',
        model: 'gemini-2.5-flash',
        async analyze(imageBase64, mime, prompt) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${GEMINI_API_KEY}`;
            const { data } = await axios.post(
                url,
                {
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                { text: SYSTEM_PROMPT },
                                { text: prompt },
                                { inline_data: { mime_type: mime, data: imageBase64 } },
                            ],
                        },
                    ],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
                },
                { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_PER_PROVIDER }
            );
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Empty Gemini response');
            return text;
        },
    },
];

// ═══════════════════════════════════════
// PROVIDERS SANS CLÉ (fallbacks)
// ═══════════════════════════════════════

const KEYLESS_PROVIDERS = [
    {
        name: 'OVHcloud',
        model: 'Qwen2.5-VL-72B-Instruct',
        async analyze(imageBase64, mime, prompt) {
            // Endpoint anonyme OVHcloud (2 req/min par IP)[reference:0]
            const { data } = await axios.post(
                'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
                            ],
                        },
                    ],
                    temperature: 0.2,
                    max_tokens: 1024,
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: TIMEOUT_PER_PROVIDER,
                }
            );
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new Error('Empty OVH response');
            return text;
        },
    },
    {
        name: 'Pollinations',
        model: 'openai',
        async analyze(imageBase64, mime, prompt) {
            // Endpoint OpenAI-compatible, sans clé[reference:1][reference:2]
            const { data } = await axios.post(
                'https://gen.pollinations.ai/v1/chat/completions',
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
                            ],
                        },
                    ],
                    temperature: 0.2,
                    max_tokens: 1024,
                },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: TIMEOUT_PER_PROVIDER,
                }
            );
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new Error('Empty Pollinations response');
            return text;
        },
    },
];

// ═══════════════════════════════════════
// ORCHESTRATEUR
// ═══════════════════════════════════════

async function analyzeWithProvider(provider, imageBase64, mime, question) {
    const start = Date.now();
    try {
        const text = await provider.analyze(imageBase64, mime, question);
        return { provider: provider.name, model: provider.model, text, latency: Date.now() - start, error: null };
    } catch (err) {
        return { provider: provider.name, model: provider.model, text: null, latency: Date.now() - start, error: err.message };
    }
}

async function runAnalysis(imageBase64, mime, question) {
    // Phase 1 : providers avec clé (qualité prioritaire)
    const keyedPromises = KEYED_PROVIDERS.map(p => analyzeWithProvider(p, imageBase64, mime, question));
    const keyedResults = await Promise.allSettled(keyedPromises);
    let successes = keyedResults
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter(r => r && r.text && !r.error);

    // Phase 2 : si moins de MIN_PROVIDERS, ajouter les providers sans clé
    if (successes.length < MIN_PROVIDERS) {
        const keylessPromises = KEYLESS_PROVIDERS.map(p => analyzeWithProvider(p, imageBase64, mime, question));
        const keylessResults = await Promise.allSettled(keylessPromises);
        const keylessSuccesses = keylessResults
            .map(r => (r.status === 'fulfilled' ? r.value : null))
            .filter(r => r && r.text && !r.error);
        successes = [...successes, ...keylessSuccesses];
    }

    // Phase 3 : si toujours pas assez, compléter avec n'importe quel provider restant
    if (successes.length < MIN_PROVIDERS) {
        const allProviders = [...KEYED_PROVIDERS, ...KEYLESS_PROVIDERS];
        const remaining = allProviders.filter(p => !successes.some(s => s.provider === p.name));
        const extraPromises = remaining.map(p => analyzeWithProvider(p, imageBase64, mime, question));
        const extraResults = await Promise.allSettled(extraPromises);
        const extraSuccesses = extraResults
            .map(r => (r.status === 'fulfilled' ? r.value : null))
            .filter(r => r && r.text && !r.error);
        successes = [...successes, ...extraSuccesses];
    }

    return successes.slice(0, MAX_PROVIDERS);
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'analyse',
    aliases: ['analyze', 'vision', 'scan'],
    category: 'ai',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;
        const senderId = getSenderId(msg);

        // ─────────────────────────────────
        // Aide
        // ─────────────────────────────────
        if (args.length === 0) {
            return sock.sendMessage(from, {
                text:
                    '🔍 *Image Analysis — Vision AI*\n\n' +
                    '⚡ *Usage:*\n' +
                    '• Reply to an image + `.analyse <question>`\n' +
                    '• `.analyse <question>` (with image caption)\n' +
                    '• Add `pro` as first word for unlimited mode\n\n' +
                    '✨ *Examples:*\n' +
                    '`.analyse How many people are in this picture?`\n' +
                    '`.analyse pro Who is this celebrity?`\n\n' +
                    '⏱ *Free mode:* 1 analysis / 15 minutes\n' +
                    '🚀 *Pro mode:* unlimited (suffix `pro`)\n\n' +
                    '🧠 *Providers:* Groq, Gemini, OVHcloud, Pollinations\n' +
                    '📊 *Returns:* 2 to 3 independent analyses\n\n' +
                    '⚡ _Powered by Zenitsu AI_',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Parse args
        // ─────────────────────────────────
        let isPro = false;
        let questionParts = [...args];
        if (questionParts[0]?.toLowerCase() === 'pro') {
            isPro = true;
            questionParts.shift();
        }
        const question = questionParts.join(' ').trim();
        if (!question) {
            return sock.sendMessage(from, {
                text: '❌ *Please provide a question.*\n\nExample: `.analyse What is in this image?`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Image
        // ─────────────────────────────────
        const image = await downloadImageFromMessage(sock, msg);
        if (!image) {
            return sock.sendMessage(from, {
                text: '❌ *No image found.*\n\nReply to an image or send an image with the command as caption.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Limit
        // ─────────────────────────────────
        const limit = checkLimit(senderId, isPro);
        if (!limit.allowed) {
            const minutes = Math.floor(limit.remaining / 60);
            const seconds = limit.remaining % 60;
            return sock.sendMessage(from, {
                text:
                    `⏳ *Limit reached*\n\n` +
                    `You can analyse another image in *${minutes}m ${seconds}s*.\n\n` +
                    '💡 *Tip:* use `.analyse pro <question>` for unlimited mode.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Processing
        // ─────────────────────────────────
        try { await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } }); } catch (_) {}

        const statusMsg = await sock.sendMessage(from, {
            text:
                `🔍 *Analyzing image...*\n\n` +
                `❓ *Question:* ${question.slice(0, 200)}\n` +
                `🚀 *Mode:* ${isPro ? 'Pro (unlimited)' : 'Free (15 min limit)'}\n` +
                `🧠 *Providers:* up to ${MAX_PROVIDERS}\n\n` +
                `_Please wait..._`,
            contextInfo: STYLE,
        }, { quoted: msg });

        // ─────────────────────────────────
        // Run analysis
        // ─────────────────────────────────
        const results = await runAnalysis(image.base64, image.mime, question);

        // ─────────────────────────────────
        // Response (même si 1 seul résultat)
        // ─────────────────────────────────
        if (results.length === 0) {
            try { await sock.sendMessage(from, { delete: statusMsg.key }); } catch (_) {}
            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            return sock.sendMessage(from, {
                text:
                    '❌ *Analysis failed*\n\n' +
                    'All providers (Groq, Gemini, OVHcloud, Pollinations) are unavailable.\n\n' +
                    '💡 Check your API keys or retry in a few moments.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Build response (1 à 3 résultats)
        // ─────────────────────────────────
        let reply = `🔍 *Image Analysis*\n\n`;
        reply += `❓ *Question:* ${question.slice(0, 200)}\n`;
        reply += `🚀 *Mode:* ${isPro ? 'Pro' : 'Free'}\n`;
        reply += `📊 *Results:* ${results.length}\n\n`;
        reply += `━━━━━━━━━━━━━━━\n\n`;

        results.forEach((r, i) => {
            reply += `*${i + 1}. ${r.provider}* (${r.model})\n`;
            reply += `⏱ ${(r.latency / 1000).toFixed(1)}s\n\n`;
            reply += `${r.text}\n\n`;
            if (i < results.length - 1) reply += `━━━━━━━━━━━━━━━\n\n`;
        });

        reply += `━━━━━━━━━━━━━━━\n`;
        reply += `⚡ _Powered by Zenitsu AI_`;

        try { await sock.sendMessage(from, { delete: statusMsg.key }); } catch (_) {}

        await sock.sendMessage(from, { text: reply, contextInfo: STYLE }, { quoted: msg });

        setLimit(senderId);
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}
    },
};
