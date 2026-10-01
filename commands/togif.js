// ./commands/togif.js

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

// FFmpeg path
let FFMPEG_PATH = 'ffmpeg';
try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) FFMPEG_PATH = ffmpegStatic;
} catch (_) {}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────
// Vérifier FFmpeg
// ─────────────────────────────────
function checkFfmpeg() {
    return new Promise((resolve) => {
        exec(`"${FFMPEG_PATH}" -version`, { timeout: 5000 }, (err, stdout) => {
            if (err) {
                console.log('❌ FFmpeg check failed:', err.message);
                resolve(false);
            } else {
                const version = (stdout || '').split('\n')[0];
                console.log('✅ FFmpeg:', version);
                resolve(true);
            }
        });
    });
}

// ─────────────────────────────────
// Téléchargements
// ─────────────────────────────────
async function downloadMediaFromMessage(msg) {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) return null;

        if (quoted.videoMessage) {
            const stream = await downloadContentFromMessage(quoted.videoMessage, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return { buffer: buffer.length > 0 ? buffer : null, type: 'video' };
        }

        if (quoted.stickerMessage) {
            const stream = await downloadContentFromMessage(quoted.stickerMessage, 'sticker');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return { buffer: buffer.length > 0 ? buffer : null, type: 'sticker' };
        }

        if (quoted.documentMessage?.mimetype?.includes('video')) {
            const stream = await downloadContentFromMessage(quoted.documentMessage, 'document');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return { buffer: buffer.length > 0 ? buffer : null, type: 'video' };
        }

        return null;
    } catch (err) {
        console.log('⚠️ Download error:', err.message);
        return null;
    }
}

async function downloadFromUrl(url) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
    });
    return Buffer.from(response.data);
}

// ─────────────────────────────────
// Conversion vidéo → GIF (MP4 léger)
// ─────────────────────────────────
async function videoToGif(inputBuffer, options = {}) {
    const { fps = 10, width = 320, maxDuration = 15 } = options;

    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `togif_in_${ts}.mp4`);
    const outputPath = path.join(tmpDir, `togif_out_${ts}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    // ⚡ Configuration ULTRA-LÉGÈRE pour Render free tier
    // - Preset ultrafast = minimum CPU
    // - 1 thread = moins de RAM
    // - Résolution 320p = ~50KB par seconde
    // - FPS 10 = fluide mais léger
    // - CRF 32 = compression maximale
    const vf = `fps=${fps},scale=${width}:-1:flags=fast_bilinear`;

    const cmd =
        `"${FFMPEG_PATH}" -i "${inputPath}" ` +
        `-t ${maxDuration} ` +
        `-vf "${vf}" ` +
        `-c:v libx264 ` +
        `-preset ultrafast ` +
        `-crf 32 ` +
        `-pix_fmt yuv420p ` +
        `-an ` +
        `-threads 1 ` +
        `-movflags +faststart ` +
        `-y "${outputPath}"`;

    return new Promise((resolve, reject) => {
        console.log('🎬 Running FFmpeg...');
        const child = exec(cmd, { timeout: 120000, maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

            if (err) {
                // Afficher la vraie erreur ffmpeg
                const stderrTail = (stderr || '').split('\n').slice(-5).join('\n');
                console.log('❌ FFmpeg error:', err.message);
                console.log('FFmpeg stderr (last lines):', stderrTail);
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                return reject(new Error('FFmpeg conversion failed'));
            }

            try {
                const buffer = fs.readFileSync(outputPath);
                fs.unlinkSync(outputPath);
                if (!buffer || buffer.length < 500) {
                    return reject(new Error('Converted file is empty'));
                }
                console.log(`✅ GIF created: ${(buffer.length / 1024).toFixed(1)} KB`);
                resolve(buffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ─────────────────────────────────
// Conversion sticker → GIF
// ─────────────────────────────────
async function stickerToGif(inputBuffer, options = {}) {
    const { fps = 10, width = 320 } = options;

    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `togif_stk_${ts}.webp`);
    const outputPath = path.join(tmpDir, `togif_stk_out_${ts}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    const vf = `fps=${fps},scale=${width}:-1:flags=fast_bilinear,format=yuv420p`;

    const cmd =
        `"${FFMPEG_PATH}" -i "${inputPath}" ` +
        `-t 6 ` +
        `-vf "${vf}" ` +
        `-c:v libx264 ` +
        `-preset ultrafast ` +
        `-crf 32 ` +
        `-an ` +
        `-threads 1 ` +
        `-movflags +faststart ` +
        `-y "${outputPath}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 90000, maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

            if (err) {
                const stderrTail = (stderr || '').split('\n').slice(-5).join('\n');
                console.log('❌ Sticker FFmpeg error:', err.message);
                console.log('FFmpeg stderr:', stderrTail);
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                return reject(new Error('Sticker conversion failed'));
            }

            try {
                const buffer = fs.readFileSync(outputPath);
                fs.unlinkSync(outputPath);
                if (!buffer || buffer.length < 500) {
                    return reject(new Error('Converted sticker is empty'));
                }
                console.log(`✅ Sticker GIF created: ${(buffer.length / 1024).toFixed(1)} KB`);
                resolve(buffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

module.exports = {
    name: 'togif',
    aliases: ['togiphy', 'togifwa', 'gifconvert'],
    category: 'tools',
    description: 'Convert videos and stickers to WhatsApp GIF',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Parse arguments
        // ─────────────────────────────────
        let mediaUrl = null;
        let customFps = null;
        let customWidth = null;

        for (const arg of args) {
            const lower = arg.toLowerCase();
            const fpsMatch = lower.match(/^(?:fps|f)=(\d+)$/);
            if (fpsMatch) {
                const v = parseInt(fpsMatch[1]);
                if (v >= 5 && v <= 20) customFps = v;
                continue;
            }
            const widthMatch = lower.match(/^(?:width|w|size)=(\d+)$/);
            if (widthMatch) {
                const v = parseInt(widthMatch[1]);
                if (v >= 120 && v <= 480) customWidth = v;
                continue;
            }
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
                      '*Fix:* Add `ffmpeg-static` to dependencies:\n' +
                      '`npm install ffmpeg-static`',
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Récupérer le média
        // ─────────────────────────────────
        let media = await downloadMediaFromMessage(msg);

        if (!media && mediaUrl) {
            try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}
            try {
                const buffer = await downloadFromUrl(mediaUrl);
                media = { buffer, type: 'video' };
            } catch (e) {
                console.log('URL download failed:', e.message);
            }
        }

        if (!media || !media.buffer) {
            return sock.sendMessage(from, {
                text: '🎬 *Video → GIF Converter*\n\n' +
                      '📌 *Usage:*\n' +
                      '• Reply to a *video* + `.togif`\n' +
                      '• Reply to a *sticker* + `.togif`\n' +
                      '• `.togif <url>`\n\n' +
                      '⚙️ *Options:*\n' +
                      '• `fps=10` — frames per second (5-20)\n' +
                      '• `width=320` — resolution (120-480)\n\n' +
                      '💡 *Examples:*\n' +
                      '`.togif`\n' +
                      '`.togif fps=15`\n' +
                      '`.togif width=240 fps=8`',
            }, { quoted: msg });
        }

        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        const processingMsg = await sock.sendMessage(from, {
            text: `🎬 *Converting to GIF...*\n\n` +
                  `📼 Source: *${media.type}*\n` +
                  `📐 Width: *${customWidth || 320}px*\n` +
                  `⚡ FPS: *${customFps || 10}*\n` +
                  `⏱️ Max: *${media.type === 'sticker' ? '6s' : '15s'}*\n\n` +
                  `_This may take 10-30s..._`,
        }, { quoted: msg });

        try {
            const options = {
                fps: customFps || 10,
                width: customWidth || 320,
                maxDuration: media.type === 'sticker' ? 6 : 15,
            };

            let gifBuffer;
            if (media.type === 'sticker') {
                gifBuffer = await stickerToGif(media.buffer, options);
            } else {
                gifBuffer = await videoToGif(media.buffer, options);
            }

            const sizeMB = gifBuffer.length / 1024 / 1024;
            if (sizeMB > 16) {
                throw new Error(`File too large (${sizeMB.toFixed(1)}MB > 16MB). Try: .togif width=240 fps=8`);
            }

            // Envoi en GIF (MP4 + gifPlayback)
            await sock.sendMessage(from, {
                video: gifBuffer,
                gifPlayback: true,
                mimetype: 'video/mp4',
            });

            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}
            try { await sock.sendMessage(from, { delete: processingMsg.key }); } catch (_) {}

        } catch (err) {
            console.error('❌ TOGIF error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            try { await sock.sendMessage(from, { delete: processingMsg.key }); } catch (_) {}

            let errorMsg = '❌ *Conversion Failed*\n\n';

            if (err.message.includes('FFmpeg')) {
                errorMsg += '⚙️ *FFmpeg error*\n' +
                            '_Media format not supported or corrupted._\n\n' +
                            '💡 *Try:*\n' +
                            '• A shorter video (<15s)\n' +
                            '• Lower settings: `.togif width=240 fps=8`';
            } else if (err.message.includes('too large')) {
                errorMsg += '📦 *File too large*\n\n' +
                            '💡 *Try:* `.togif width=240 fps=8`';
            } else if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\n_The video is too long or the server is slow._';
            } else {
                errorMsg += `⚠️ ${err.message}`;
            }

            await sock.sendMessage(from, { text: errorMsg }, { quoted: msg });
        }
    },
};