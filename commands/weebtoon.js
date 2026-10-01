// ./commands/webtoon.js

const axios = require('axios');

// API
const API_BASE = 'https://api.deline.web.id/search/webtoon';

// Limites
const MAX_RESULTS = 8;
const DELAY_BETWEEN = 1500; // 1.5s entre chaque envoi

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

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
                      '`.webtoon <name>`\n\n' +
                      '💡 *Examples:*\n' +
                      '`.webtoon lookism`\n' +
                      '`.webtoon love`',
            }, { quoted: msg });
        }

        try { await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } }); } catch (_) {}

        try {
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

            // Combiner original + canvas (original en premier)
            const allResults = [
                ...(data.result.original || []).map(r => ({ ...r, type: 'Original' })),
                ...(data.result.canvas || []).map(r => ({ ...r, type: 'Canvas' })),
            ];

            if (allResults.length === 0) {
                try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}
                return sock.sendMessage(from, {
                    text: `❌ *No results found for "${query}"*`,
                }, { quoted: msg });
            }

            const results = allResults.slice(0, MAX_RESULTS);

            // ─────────────────────────────────
            // Message d'en-tête (résumé)
            // ─────────────────────────────────
            await sock.sendMessage(from, {
                text: `📚 *Webtoon Search*\n\n` +
                      `🔍 Query: *${query}*\n` +
                      `📊 Results: *${allResults.length}* (showing ${results.length})\n` +
                      `📁 Original: ${data.result.original?.length || 0} | Canvas: ${data.result.canvas?.length || 0}\n\n` +
                      `_Sending results below..._`,
            }, { quoted: msg });

            await delay(800);

            // ─────────────────────────────────
            // Envoi image + infos individuels
            // ─────────────────────────────────
            for (let i = 0; i < results.length; i++) {
                const item = results[i];

                const caption =
                    `📖 *${item.title}*\n\n` +
                    `👤 *Author:* ${item.author || 'Unknown'}\n` +
                    `👁️ *Views:* ${item.viewCount || '0'}\n` +
                    `📁 *Type:* ${item.type}\n` +
                    `${item.isNew ? '🆕 *NEW RELEASE*\n' : ''}` +
                    `\n🔗 ${item.link}`;

                try {
                    if (item.image) {
                        await sock.sendMessage(from, {
                            image: { url: item.image },
                            caption: caption,
                        });
                    } else {
                        await sock.sendMessage(from, {
                            text: caption,
                        });
                    }
                } catch (imgErr) {
                    console.log(`⚠️ Image ${i + 1} failed: ${imgErr.message}`);
                    // Envoyer le texte sans image
                    try {
                        await sock.sendMessage(from, { text: caption });
                    } catch (_) {}
                }

                // Délai entre chaque envoi
                if (i < results.length - 1) await delay(DELAY_BETWEEN);
            }

            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ Webtoon error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            let errorMsg = '❌ *Webtoon Search Failed*\n\n';

            if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\nThe API is taking too long.\n\n_Try again in a few moments._';
            } else if (err.message.includes('Invalid API response')) {
                errorMsg += '🔗 *API Error*\nInvalid response format.\n\n_Try again later._';
            } else {
                errorMsg += `💥 *Error*\n\n${err.message}`;
            }

            await sock.sendMessage(from, { text: errorMsg }, { quoted: msg });
        }
    },
};