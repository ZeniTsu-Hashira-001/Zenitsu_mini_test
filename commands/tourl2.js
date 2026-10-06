// ./commands/tourl2.js

const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const FormData = require('form-data');

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
// TÉLÉCHARGEMENT
// ═══════════════════════════════════════

async function downloadMedia(mediaMessage, type) {
    const stream = await downloadContentFromMessage(mediaMessage, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

// ═══════════════════════════════════════
// SERVICES D'UPLOAD PERMANENT
// ═══════════════════════════════════════

const PERMANENT_SERVICES = [
    {
        name: 'Catbox',
        fn: async (buffer, filename) => {
            const form = new FormData();
            form.append('fileToUpload', buffer, { filename });
            form.append('reqtype', 'fileupload');
            const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
                headers: form.getHeaders(),
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            const url = typeof data === 'string' ? data.trim() : '';
            if (url && url.startsWith('http')) return url;
            throw new Error('Invalid response from Catbox');
        },
    },
    {
        name: 'Freeimage.host',
        fn: async (buffer, filename) => {
            const form = new FormData();
            form.append('source', buffer, { filename });
            form.append('type', 'file');
            form.append('action', 'upload');
            const { data } = await axios.post('https://freeimage.host/api/1/upload', form, {
                headers: {
                    ...form.getHeaders(),
                    'X-API-Key': '6d207e02198a847aa98d0a2a901485a5',
                },
                timeout: 60000,
            });
            const url = data?.image?.url || data?.image?.display_url;
            if (typeof url === 'string' && url.startsWith('http')) return url;
            throw new Error('Invalid response from Freeimage.host');
        },
    },
    {
        name: '0x0.st',
        fn: async (buffer, filename) => {
            const form = new FormData();
            form.append('file', buffer, { filename });
            const { data } = await axios.post('https://0x0.st', form, {
                headers: form.getHeaders(),
                timeout: 60000,
            });
            const url = typeof data === 'string' ? data.trim() : '';
            if (url && url.startsWith('http')) return url;
            throw new Error('Invalid response from 0x0.st');
        },
    },
    {
        name: 'Tmpfiles',
        fn: async (buffer, filename) => {
            const form = new FormData();
            form.append('file', buffer, { filename });
            const { data } = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
                headers: form.getHeaders(),
                timeout: 60000,
            });
            const url = data?.data?.url;
            if (typeof url === 'string' && url.startsWith('http')) {
                return url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
            }
            throw new Error('Invalid response from Tmpfiles');
        },
    },
    {
        name: 'Uguu',
        fn: async (buffer, filename) => {
            const form = new FormData();
            form.append('files[]', buffer, { filename });
            const { data } = await axios.post('https://uguu.se/upload.php', form, {
                headers: form.getHeaders(),
                timeout: 60000,
            });
            const url = data?.files?.[0]?.url;
            if (typeof url === 'string' && url.startsWith('http')) return url;
            throw new Error('Invalid response from Uguu');
        },
    },
];

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'tourl2',
    aliases: ['upload2', 'permanenturl', 'uploadpermanent'],
    category: 'tools',

    async execute({ sock, msg, args, jid }) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted) {
            return sock.sendMessage(jid, {
                text:
                    '📤 *Permanent Upload*\n\n' +
                    '⚡ *Usage:*\n' +
                    '.tourl2 (reply to media/file)\n\n' +
                    '💡 Uploads permanently.\n' +
                    '🔄 Multiple services with fallback.\n\n' +
                    '📁 *Supported:* Images, Videos, Audio, Documents, Stickers',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        try { await sock.sendMessage(jid, { react: { text: '📤', key: msg.key } }); } catch (_) {}

        // ─────────────────────────────────
        // Détection du type de média
        // ─────────────────────────────────
        let mediaType = null;
        let mediaMessage = null;
        let filename = '';

        if (quoted.imageMessage) {
            mediaType = 'image';
            mediaMessage = quoted.imageMessage;
            filename = `image_${Date.now()}.jpg`;
        } else if (quoted.videoMessage) {
            mediaType = 'video';
            mediaMessage = quoted.videoMessage;
            filename = `video_${Date.now()}.mp4`;
        } else if (quoted.audioMessage) {
            mediaType = 'audio';
            mediaMessage = quoted.audioMessage;
            filename = `audio_${Date.now()}.${quoted.audioMessage.ptt ? 'ogg' : 'mp3'}`;
        } else if (quoted.documentMessage) {
            mediaType = 'document';
            mediaMessage = quoted.documentMessage;
            filename = quoted.documentMessage.fileName || `doc_${Date.now()}.bin`;
        } else if (quoted.stickerMessage) {
            mediaType = 'sticker';
            mediaMessage = quoted.stickerMessage;
            filename = `sticker_${Date.now()}.webp`;
        } else {
            return sock.sendMessage(jid, {
                text: '❌ Unsupported media type.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        try {
            const buffer = await downloadMedia(mediaMessage, mediaType);

            if (!buffer || buffer.length < 100) {
                throw new Error('Download failed or file too small');
            }

            const sizeMB = (buffer.length / 1048576).toFixed(2);
            let uploadedUrl = null;
            let usedService = '';

            // ─────────────────────────────────
            // ⚠️ CORRECTION CRITIQUE :
            // uploadedUrl n'est assigné QUE si la valeur
            // retournée est une string valide commençant par http.
            // Avant, une fonction/objet retourné par un service
            // en échec restait stocké et était affiché.
            // ─────────────────────────────────
            for (const service of PERMANENT_SERVICES) {
                try {
                    console.log(`📤 Uploading to ${service.name}...`);
                    const result = await service.fn(buffer, filename);

                    // ✅ Vérification stricte du type
                    if (typeof result === 'string' && result.startsWith('http')) {
                        uploadedUrl = result;
                        usedService = service.name;
                        console.log(`✅ Uploaded via ${service.name}: ${result}`);
                        break;
                    } else {
                        console.log(`⚠️ ${service.name} returned invalid type: ${typeof result}`);
                    }
                } catch (err) {
                    console.log(`⚠️ ${service.name} failed: ${err.message}`);
                }
            }

            // ─────────────────────────────────
            // Échec total
            // ─────────────────────────────────
            if (!uploadedUrl || typeof uploadedUrl !== 'string') {
                try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
                return sock.sendMessage(jid, {
                    text:
                        '❌ *All upload services failed*\n\n' +
                        '_Please try again in a few moments or with a smaller file._',
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            // ─────────────────────────────────
            // Succès
            // ─────────────────────────────────
            await sock.sendMessage(jid, {
                text:
                    '📤 *Upload Complete (Permanent)*\n\n' +
                    `📄 *File:* ${filename}\n` +
                    `📏 *Size:* ${sizeMB} MB\n` +
                    `📁 *Type:* ${mediaType}\n` +
                    `🏷️ *Service:* ${usedService}\n\n` +
                    `🔗 *URL:*\n${uploadedUrl}\n\n` +
                    '⚡ _Zenitsu_',
                contextInfo: STYLE,
            }, { quoted: msg });

            try { await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ tourl2:', err.message);
            try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            await sock.sendMessage(jid, {
                text: `❌ Failed: ${err.message}`,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};