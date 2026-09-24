// ./commands/attp.js

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

// Packname & Author (style Cybernova)
const PACK_NAME = '모🅒🅨🅑🅔🅡🅝🅞🅥🅐 🌟';
const AUTHOR = '⚡ Zenitsu Mini V4.1.1';

// API de génération ATTP
const ATTP_API = 'https://api.deline.web.id/maker/attp';

// ═══════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════

async function downloadVideoFromUrl(url, timeout = 60000) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: timeout,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'video/*,image/*,*/*;q=0.8',
            },
        });
        const buffer = Buffer.from(response.data);
        if (!buffer || buffer.length < 1024) {
            throw new Error('Downloaded file is too small or empty');
        }
        return buffer;
    } catch (error) {
        console.error(`❌ ATTP download error: ${error.message}`);
        throw error;
    }
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'attp',
    aliases: ['attpsticker', 'animatedtext', 'attpvideo'],
    category: 'maker',
    description: 'Generate animated text sticker (ATTP) from text',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Récupérer le texte
        // ─────────────────────────────────
        let text = args.join(' ').trim();

        // Si pas de texte, vérifier si on répond à un message
        if (!text) {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                text = quoted.conversation || quoted.extendedTextMessage?.text || '';
            }
        }

        // Si toujours pas de texte
        if (!text) {
            return sock.sendMessage(from, {
                text: '✨ *ATTP — Animated Text Sticker*\n\n' +
                      '📌 *Usage:*\n' +
                      '`.attp <text>` — Generate animated sticker\n' +
                      'Reply to a message with `.attp` to use its text\n\n' +
                      '💡 *Examples:*\n' +
                      '`.attp Hello World`\n' +
                      '`.attp Zenitsu`\n' +
                      '`.attp Bonjour`\n\n' +
                      '⚡ _Powered by Cybernova_',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Nettoyer le texte (limite de longueur pour l'API)
        if (text.length > 50) {
            text = text.substring(0, 50);
        }

        // Loading reaction
        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        try {
            // ─────────────────────────────────
            // Appel API ATTP
            // ─────────────────────────────────
            const encodedText = encodeURIComponent(text);
            const apiUrl = `${ATTP_API}?text=${encodedText}`;

            console.log(`🎨 ATTP: Generating for "${text}"...`);

            // L'API peut renvoyer directement un fichier binaire ou une URL
            let videoBuffer;
            
            try {
                // Essayer de télécharger directement le binaire
                const response = await axios.get(apiUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    },
                });
                videoBuffer = Buffer.from(response.data);
                
                // Vérifier si c'est du JSON (URL)
                const contentType = response.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    const jsonData = JSON.parse(videoBuffer.toString());
                    const videoUrl = jsonData.url || jsonData.data?.url || jsonData.result;
                    if (videoUrl) {
                        videoBuffer = await downloadVideoFromUrl(videoUrl);
                    } else {
                        throw new Error('No video URL in API response');
                    }
                }
            } catch (apiError) {
                console.log('⚠️ Direct download failed, trying as JSON...');
                // Réessayer en tant que JSON
                const response = await axios.get(apiUrl, {
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    },
                });
                const jsonData = response.data;
                const videoUrl = jsonData.url || jsonData.data?.url || jsonData.result;
                if (!videoUrl) {
                    throw new Error('API did not return a valid video URL');
                }
                videoBuffer = await downloadVideoFromUrl(videoUrl);
            }

            // Vérification finale
            if (!videoBuffer || videoBuffer.length < 1000) {
                throw new Error('Generated video is too small or empty');
            }

            const sizeKB = (videoBuffer.length / 1024).toFixed(2);
            console.log(`✅ ATTP generated: ${sizeKB} KB`);

            // ─────────────────────────────────
            // Envoi du sticker animé
            // ─────────────────────────────────
            await sock.sendMessage(from, {
                sticker: videoBuffer,
                isAnimated: true,        // Sticker animé
                mimetype: 'video/mp4',
                // ⚠️ PAS de contextInfo pour garantir la réussite du sticker
            });

            // Note : Baileys ne supporte pas directement packname/author
            // dans l'envoi de sticker, mais les métadonnées sont dans le fichier
            // Pour les ajouter, il faudrait un package comme wa-sticker-formatter

            // Success reaction
            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ ATTP error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            let errorMsg = '❌ *ATTP Generation Failed*\n\n';

            if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\nThe API is taking too long to respond.\n\n_Try again in a few moments._';
            } else if (err.message.includes('too small') || err.message.includes('empty')) {
                errorMsg += '📦 *Invalid response*\nThe API returned an empty or corrupted file.\n\n_Try again with different text._';
            } else if (err.message.includes('No video URL')) {
                errorMsg += '🔗 *No video URL*\nThe API response format is not recognized.\n\n_Try again later._';
            } else {
                errorMsg += `💥 *Technical error*\n\n${err.message}\n\n_Try again later._`;
            }

            errorMsg += '\n\n━━━━━━━━━━━━━━━\n_©CybernovA_';

            await sock.sendMessage(from, {
                text: errorMsg,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};