// ./commands/tovn.js

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

// ═══════════════════════════════════════
// STYLE (uniquement pour les messages texte)
// ═══════════════════════════════════════

const STYLE = {
    forwardingScore: 540,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363425394543602@newsletter',
        newsletterName: '모🅒🅨🅑🅔🅡🅝🅞🅥🅐 🌟',
        serverMessageId: 340,
    },
};

// ═══════════════════════════════════════
// FFMPEG PATH (fallback ffmpeg-static)
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
// TÉLÉCHARGEMENT VIDÉO
// ═══════════════════════════════════════

async function downloadVideoFromMessage(msg) {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) return null;

        const videoMessage = quoted.videoMessage;
        if (!videoMessage) return null;

        const stream = await downloadContentFromMessage(videoMessage, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
    } catch (err) {
        console.log('⚠️ Error downloading video from message:', err.message);
        return null;
    }
}

async function downloadVideoFromUrl(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'video/*,*/*;q=0.8',
            },
        });
        return Buffer.from(response.data);
    } catch (err) {
        console.log('⚠️ Error downloading video from URL:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════
// CONVERSION VIDÉO → VIDEO NOTE
// ═══════════════════════════════════════

async function convertToVN(inputBuffer, withAudio = false) {
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `tovn_in_${ts}.mp4`);
    const outputPath = path.join(tmpDir, `tovn_out_${ts}.mp4`);

    fs.writeFileSync(inputPath, inputBuffer);

    // WhatsApp Video Note requirements:
    // - Square (1:1) — WhatsApp affiche en rond
    // - Max 60 secondes
    // - Résolution 480x480 (suffisant, évite les rejets)
    // - H.264 + AAC (ou sans audio)
    // - faststart pour streaming
    const vfFilter = `crop=min(iw\\,ih):min(iw\\,ih),scale=480:480`;

    let ffmpegCmd;
    if (withAudio) {
        ffmpegCmd =
            `"${FFMPEG_PATH}" -i "${inputPath}" ` +
            `-t 60 ` +
            `-vf "${vfFilter}" ` +
            `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p ` +
            `-c:a aac -b:a 64k -ar 44100 ` +
            `-movflags +faststart ` +
            `-y "${outputPath}"`;
    } else {
        ffmpegCmd =
            `"${FFMPEG_PATH}" -i "${inputPath}" ` +
            `-t 60 ` +
            `-vf "${vfFilter}" ` +
            `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p ` +
            `-an ` +
            `-movflags +faststart ` +
            `-y "${outputPath}"`;
    }

    return new Promise((resolve, reject) => {
        exec(ffmpegCmd, { timeout: 180000, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
            // Nettoyer l'entrée
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

            if (err) {
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                return reject(new Error('FFmpeg conversion failed'));
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

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'tovn',
    aliases: ['tovideonote', 'vn', 'videonote'],
    category: 'tools',
    description: 'Convert video to WhatsApp Video Note (PTV)',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Parse arguments
        // ─────────────────────────────────
        let withAudio = false;
        let videoUrl = null;

        for (const arg of args) {
            const lower = arg.toLowerCase();
            if (['sound', 'audio', 'withsound', 'with-audio'].includes(lower)) {
                withAudio = true;
            } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
                videoUrl = arg;
            }
        }

        // ─────────────────────────────────
        // Vérifier FFmpeg
        // ─────────────────────────────────
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
            return sock.sendMessage(from, {
                text: '❌ *FFmpeg not available*\n\n' +
                      'FFmpeg is required to convert videos.\n\n' +
                      '*Fix:* Add `ffmpeg-static` to dependencies:\n' +
                      '`npm install ffmpeg-static`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Récupérer la vidéo (reply > URL)
        // ─────────────────────────────────
        let videoBuffer = null;

        // Priorité 1 : réponse à une vidéo
        videoBuffer = await downloadVideoFromMessage(msg);

        // Priorité 2 : URL fournie
        if (!videoBuffer && videoUrl) {
            try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}
            videoBuffer = await downloadVideoFromUrl(videoUrl);
        }

        // Aucune vidéo trouvée
        if (!videoBuffer) {
            return sock.sendMessage(from, {
                text:
                    '❌ *Video Note Converter*\n\n' +
                    '📌 *Usage:*\n' +
                    '• Reply to a video + `.tovn` → *no sound*\n' +
                    '• Reply to a video + `.tovn sound` → *with sound*\n' +
                    '• `.tovn [sound] <url>` → *from URL*\n\n' +
                    '⚙️ *Requirements:*\n' +
                    '• Video ≤ 60s (auto-truncated)\n' +
                    '• MP4 / H.264 recommended\n' +
                    '• Max ~16 MB result\n\n' +
                    '💡 *Examples:*\n' +
                    '`.tovn`\n' +
                    '`.tovn sound`\n' +
                    '`.tovn sound https://ex.com/vid.mp4`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Loading reaction
        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        // Message de traitement
        const processingMsg = await sock.sendMessage(from, {
            text: `🎬 *Converting video to Video Note...*\n\n` +
                  `🔊 Sound : *${withAudio ? 'ON' : 'OFF'}*\n` +
                  `⏱️ Duration limit : *60s*\n` +
                  `📐 Format : *1:1 (round)*\n\n` +
                  `_Please wait..._`,
            contextInfo: STYLE,
        }, { quoted: msg });

        try {
            // Conversion
            const vnBuffer = await convertToVN(videoBuffer, withAudio);

            // Vérification taille max WhatsApp (~16 MB pour PTV)
            const sizeMB = vnBuffer.length / 1024 / 1024;
            if (sizeMB > 16) {
                throw new Error(`File too large (${sizeMB.toFixed(1)}MB > 16MB)`);
            }

            // ═══════════════════════════════════
            // ENVOI EN VIDEO NOTE (PTV)
            // ⚠️ PAS de contextInfo/style forwarded → garantit le succès
            // ═══════════════════════════════════
            await sock.sendMessage(from, {
                video: vnBuffer,
                ptv: true,
                mimetype: 'video/mp4',
                // ⚠️ AUCUN contextInfo ici — indispensable pour la VN
            });

            // Success reaction
            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

            // Supprimer le message de traitement
            try { await sock.sendMessage(from, { delete: processingMsg.key }); } catch (_) {}

        } catch (err) {
            console.error('❌ TOVN error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            try { await sock.sendMessage(from, { delete: processingMsg.key }); } catch (_) {}

            let errorMsg = '❌ *Conversion Failed*\n\n';

            if (err.message.includes('FFmpeg')) {
                errorMsg += '⚙️ *FFmpeg error*\n\n' +
                            '_Video format not supported or corrupted. Try another video._';
            } else if (err.message.includes('too large')) {
                errorMsg += '📦 *File too large*\n\n' +
                            '_WhatsApp Video Notes are limited to ~16 MB._\n' +
                            '_Try a shorter or lower quality video._';
            } else if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\n\n' +
                            '_Video is too long or server is slow._';
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