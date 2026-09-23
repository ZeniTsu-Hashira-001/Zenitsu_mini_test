// ./commands/togif.js

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
// FFMPEG PATH
// ═══════════════════════════════════════

let FFMPEG_PATH = 'ffmpeg';
try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) {
        FFMPEG_PATH = ffmpegStatic;
        console.log('✅ Using ffmpeg-static:', FFMPEG_PATH);
    }
} catch (_) {
    console.log('ℹ️ Using system ffmpeg');
}

function checkFfmpeg() {
    return new Promise((resolve) => {
        exec(`"${FFMPEG_PATH}" -version`, { timeout: 5000 }, (err) => {
            resolve(!err);
        });
    });
}

// ═══════════════════════════════════════
// TÉLÉCHARGEMENT MÉDIA
// ═══════════════════════════════════════

async function downloadMediaFromMessage(msg) {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) return null;

        // Vidéo
        if (quoted.videoMessage) {
            const stream = await downloadContentFromMessage(quoted.videoMessage, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return { buffer: buffer.length > 0 ? buffer : null, type: 'video' };
        }

        // Sticker (webp animé ou statique)
        if (quoted.stickerMessage) {
            const stream = await downloadContentFromMessage(quoted.stickerMessage, 'sticker');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return { buffer: buffer.length > 0 ? buffer : null, type: 'sticker' };
        }

        // GIF/Video directement
        if (quoted.documentMessage?.mimetype?.includes('video')) {
            const stream = await downloadContentFromMessage(quoted.documentMessage, 'document');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return { buffer: buffer.length > 0 ? buffer : null, type: 'video' };
        }

        return null;
    } catch (err) {
        console.log('⚠️ Error downloading media:', err.message);
        return null;
    }
}

async function downloadFromUrl(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': '*/*',
            },
        });
        return Buffer.from(response.data);
    } catch (err) {
        console.log('⚠️ Error downloading from URL:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════
// CONVERSIONS
// ═══════════════════════════════════════

// Vidéo → GIF (MP4 avec gifPlayback)
async function convertVideoToGif(inputBuffer, options = {}) {
    const { fps = 15, width = 480, maxDuration = 30 } = options;
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `togif_in_${ts}.mp4`);
    const outputPath = path.join(tmpDir, `togif_out_${ts}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    // WhatsApp GIF = MP4 court avec playback auto
    // - Max 30s (WhatsApp limite à ~60s mais on garde 30s pour fluidité)
    // - Résolution réduite pour la fluidité
    // - Sans audio (GIF = silencieux)
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos`;
    const ffmpegCmd =
        `"${FFMPEG_PATH}" -i "${inputPath}" ` +
        `-t ${maxDuration} ` +
        `-vf "${filter}" ` +
        `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p ` +
        `-an ` +
        `-movflags +faststart ` +
        `-y "${outputPath}"`;

    return new Promise((resolve, reject) => {
        exec(ffmpegCmd, { timeout: 180000, maxBuffer: 1024 * 1024 * 50 }, (err) => {
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

            if (err) {
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                return reject(new Error('FFmpeg video→GIF conversion failed'));
            }

            try {
                const outputBuffer = fs.readFileSync(outputPath);
                fs.unlinkSync(outputPath);
                if (!outputBuffer || outputBuffer.length < 1000) {
                    return reject(new Error('Converted file is empty'));
                }
                resolve(outputBuffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Sticker (webp) → GIF (MP4)
async function convertStickerToGif(inputBuffer, options = {}) {
    const { fps = 15, width = 480 } = options;
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `togif_stk_${ts}.webp`);
    const outputPath = path.join(tmpDir, `togif_stk_out_${ts}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    // Sticker webp → MP4 (gère animé et statique)
    // - -loop 0 pour les webp animés
    // - Fond transparent → noir par défaut (ou on peut mettre du blanc)
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,format=yuv420p`;
    const ffmpegCmd =
        `"${FFMPEG_PATH}" -loop 0 -i "${inputPath}" ` +
        `-t 6 ` + // durée max pour un sticker
        `-vf "${filter}" ` +
        `-c:v libx264 -preset fast -crf 28 ` +
        `-an ` +
        `-movflags +faststart ` +
        `-y "${outputPath}"`;

    return new Promise((resolve, reject) => {
        exec(ffmpegCmd, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (err) => {
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

            if (err) {
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                return reject(new Error('FFmpeg sticker→GIF conversion failed'));
            }

            try {
                const outputBuffer = fs.readFileSync(outputPath);
                fs.unlinkSync(outputPath);
                if (!outputBuffer || outputBuffer.length < 1000) {
                    return reject(new Error('Converted sticker is empty'));
                }
                resolve(outputBuffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'togif',
    aliases: ['togiphy', 'togifwa', 'gifconvert'],
    category: 'tools',
    description: 'Convert videos and stickers to WhatsApp GIF',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Parse arguments (options)
        // ─────────────────────────────────
        let mediaUrl = null;
        let customFps = null;
        let customWidth = null;

        for (const arg of args) {
            const lower = arg.toLowerCase();

            // Options : fps=N / width=N / w=N
            const fpsMatch = lower.match(/^(?:fps|f)=(\d+)$/);
            if (fpsMatch) {
                const v = parseInt(fpsMatch[1]);
                if (v >= 5 && v <= 30) customFps = v;
                continue;
            }

            const widthMatch = lower.match(/^(?:width|w|size)=(\d+)$/);
            if (widthMatch) {
                const v = parseInt(widthMatch[1]);
                if (v >= 120 && v <= 720) customWidth = v;
                continue;
            }

            // URL
            if (arg.startsWith('http://') || arg.startsWith('https://')) {
                mediaUrl = arg;
            }
        }

        // ─────────────────────────────────
        // Vérifier FFmpeg
        // ─────────────────────────────────
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
            return sock.sendMessage(from, {
                text: '❌ *FFmpeg not available*\n\n' +
                      'FFmpeg is required to convert media.\n\n' +
                      '*Fix:* Add `ffmpeg-static` to dependencies:\n' +
                      '`npm install ffmpeg-static`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Récupérer le média (reply > URL)
        // ─────────────────────────────────
        let media = await downloadMediaFromMessage(msg);

        if (!media && mediaUrl) {
            try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}
            const buffer = await downloadFromUrl(mediaUrl);
            if (buffer) {
                media = { buffer, type: 'video' }; // URL → on suppose vidéo
            }
        }

        // Aucun média trouvé
        if (!media || !media.buffer) {
            return sock.sendMessage(from, {
                text:
                    '🎬 *Video → GIF Converter*\n\n' +
                    '📌 *Usage:*\n' +
                    '• Reply to a *video* + `.togif`\n' +
                    '• Reply to a *sticker* + `.togif`\n' +
                    '• `.togif <url>` — from URL\n\n' +
                    '⚙️ *Options:*\n' +
                    '• `fps=15` — frames per second (5-30)\n' +
                    '• `width=480` — resolution (120-720)\n\n' +
                    '💡 *Examples:*\n' +
                    '`.togif`\n' +
                    '`.togif fps=20`\n' +
                    '`.togif width=360 https://ex.com/vid.mp4`\n\n' +
                    '_🎁 Stickers animés → GIF (6s max)_\n' +
                    '_🎬 Vidéos → GIF (30s max, sans audio)_',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Loading reaction
        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        // Message de traitement
        const processingMsg = await sock.sendMessage(from, {
            text: `🎬 *Converting ${media.type} to GIF...*\n\n` +
                  `📼 Source : *${media.type}*\n` +
                  `📐 Width : *${customWidth || 480}px*\n` +
                  `⚡ FPS : *${customFps || 15}*\n` +
                  `⏱️ Duration : *${media.type === 'sticker' ? '6s' : '30s'} max*\n\n` +
                  `_Please wait..._`,
            contextInfo: STYLE,
        }, { quoted: msg });

        try {
            // Options de conversion
            const options = {
                fps: customFps || 15,
                width: customWidth || 480,
                maxDuration: media.type === 'sticker' ? 6 : 30,
            };

            // Conversion selon le type
            let gifBuffer;
            if (media.type === 'sticker') {
                gifBuffer = await convertStickerToGif(media.buffer, options);
            } else {
                gifBuffer = await convertVideoToGif(media.buffer, options);
            }

            // Vérification taille
            const sizeMB = gifBuffer.length / 1024 / 1024;
            if (sizeMB > 16) {
                throw new Error(`File too large (${sizeMB.toFixed(1)}MB > 16MB)`);
            }

            // ═══════════════════════════════════
            // ENVOI EN GIF WHATSAPP
            // gifPlayback: true → lecture auto en boucle
            // ═══════════════════════════════════
            await sock.sendMessage(from, {
                video: gifBuffer,
                gifPlayback: true,
                mimetype: 'video/mp4',
                // ⚠️ PAS de contextInfo ici pour garantir le GIF
            });

            // Success reaction
            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

            // Supprimer le message de traitement
            try { await sock.sendMessage(from, { delete: processingMsg.key }); } catch (_) {}

        } catch (err) {
            console.error('❌ TOGIF error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            try { await sock.sendMessage(from, { delete: processingMsg.key }); } catch (_) {}

            let errorMsg = '❌ *Conversion Failed*\n\n';

            if (err.message.includes('FFmpeg')) {
                errorMsg += '⚙️ *FFmpeg error*\n\n' +
                            '_Media format not supported or corrupted._\n' +
                            '_Try another video/sticker._';
            } else if (err.message.includes('too large')) {
                errorMsg += '📦 *File too large*\n\n' +
                            '_WhatsApp GIFs are limited to ~16 MB._\n' +
                            '_Try a shorter video or lower width._\n\n' +
                            '💡 *Tip:* `.togif width=320 fps=10`';
            } else if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\n\n' +
                            '_Media is too long or server is slow._';
            } else {
                errorMsg += `⚠️ ${err.message}`;
            }

            await sock.sendMessage(from, {
                text: errorMsg,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};