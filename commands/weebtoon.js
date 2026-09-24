// ./commands/webtoon.js

const axios = require('axios');

// ═══════════════════════════════════════
// STYLE CYBERNOVA
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

const API_BASE = 'https://api.deline.web.id/search/webtoon';

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'webtoon',
    aliases: ['webtoonsearch', 'wt', 'manhwa'],
    category: 'search',
    description: 'Search webtoons by name',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Récupérer la requête
        // ─────────────────────────────────
        let query = args.join(' ').trim();

        // Si pas de query, vérifier si on répond à un message
        if (!query) {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                query = quoted.conversation || quoted.extendedTextMessage?.text || '';
            }
        }

        if (!query) {
            return sock.sendMessage(from, {
                text: '📚 *Webtoon Search*\n\n' +
                      '📌 *Usage:*\n' +
                      '`.webtoon <name>` — Search webtoons\n\n' +
                      '💡 *Examples:*\n' +
                      '`.webtoon lookism`\n' +
                      '`.webtoon love`\n' +
                      '`.webtoon solo leveling`\n\n' +
                      '⚡ _Powered by Cybernova_',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Loading reaction
        try { await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } }); } catch (_) {}

        try {
            // ─────────────────────────────────
            // Appel API
            // ─────────────────────────────────
            const apiUrl = `${API_BASE}?q=${encodeURIComponent(query)}`;
            console.log(`🔍 Webtoon search: "${query}"`);

            const response = await axios.get(apiUrl, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                },
            });

            const data = response.data;

            if (!data?.status || !data?.result) {
                throw new Error('Invalid API response');
            }

            const original = data.result.original || [];
            const canvas = data.result.canvas || [];
            const totalResults = original.length + canvas.length;

            if (totalResults === 0) {
                try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}
                return sock.sendMessage(from, {
                    text: `❌ *No results found for "${query}"*\n\n` +
                          `_Try a different search term._`,
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            // ─────────────────────────────────
            // Construire le message
            // ─────────────────────────────────
            let resultText = `📚 *Webtoon Search Results*\n\n`;
            resultText += `🔍 *Query:* ${query}\n`;
            resultText += `📊 *Total:* ${totalResults} result(s)\n`;
            resultText += `📁 *Original:* ${original.length} | *Canvas:* ${canvas.length}\n\n`;

            // Original webtoons
            if (original.length > 0) {
                resultText += `━━━━━━━━━━━━━━━\n`;
                resultText += `📖 *ORIGINAL WEBTOONS*\n`;
                resultText += `━━━━━━━━━━━━━━━\n\n`;

                original.slice(0, 8).forEach((item, i) => {
                    resultText += `*${i + 1}. ${item.title}*\n`;
                    resultText += `👤 Author: ${item.author || 'Unknown'}\n`;
                    resultText += `👁️ Views: ${item.viewCount || '0'}\n`;
                    if (item.isNew) resultText += `🆕 *NEW*\n`;
                    resultText += `🔗 ${item.link}\n\n`;
                });
            }

            // Canvas webtoons (limité)
            if (canvas.length > 0 && original.length < 8) {
                const remaining = 8 - original.length;
                resultText += `━━━━━━━━━━━━━━━\n`;
                resultText += `🎨 *CANVAS WEBTOONS*\n`;
                resultText += `━━━━━━━━━━━━━━━\n\n`;

                canvas.slice(0, remaining).forEach((item, i) => {
                    resultText += `*${i + 1}. ${item.title}*\n`;
                    resultText += `👤 Author: ${item.author || 'Unknown'}\n`;
                    resultText += `👁️ Views: ${item.viewCount || '0'}\n`;
                    resultText += `🔗 ${item.link}\n\n`;
                });
            }

            resultText += `━━━━━━━━━━━━━━━\n`;
            resultText += `⚡ _Powered by Cybernova_`;

            // ─────────────────────────────────
            // Envoyer avec la première image (si disponible)
            // ─────────────────────────────────
            const firstResult = original[0] || canvas[0];
            const coverImage = firstResult?.image;

            if (coverImage) {
                try {
                    await sock.sendMessage(from, {
                        image: { url: coverImage },
                        caption: resultText,
                        contextInfo: STYLE,
                    }, { quoted: msg });
                } catch (imgErr) {
                    console.log('⚠️ Image load failed, sending text only');
                    await sock.sendMessage(from, {
                        text: resultText,
                        contextInfo: STYLE,
                    }, { quoted: msg });
                }
            } else {
                await sock.sendMessage(from, {
                    text: resultText,
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            // Success reaction
            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ Webtoon error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            let errorMsg = '❌ *Webtoon Search Failed*\n\n';

            if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\nThe API is taking too long.\n\n_Try again in a few moments._';
            } else if (err.message.includes('Invalid API response')) {
                errorMsg += '🔗 *API Error*\nThe API returned an invalid response.\n\n_Try again later._';
            } else {
                errorMsg += `💥 *Error*\n\n${err.message}`;
            }

            await sock.sendMessage(from, {
                text: errorMsg,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};