// ./commands/attp.js

const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// FFmpeg
let FFMPEG_PATH = 'ffmpeg';
try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) FFMPEG_PATH = ffmpegStatic;
} catch (_) {}

const ATTP_API = 'https://api.deline.web.id/maker/attp';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────
// Téléchargement binaire
// ─────────────────────────────────
async function downloadBinary(url, timeout = 60000) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
        },
    });
    return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type'] || '',
    };
}

// ─────────────────────────────────
// Convertir MP4 → WebP animé (sticker)
// ─────────────────────────────────
async function mp4ToWebpSticker(inputBuffer) {
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inputPath = path.join(tmpDir, `attp_in_${ts}.mp4`);
    const outputPath = path.join(tmpDir, `attp_out_${ts}.webp`);

    fs.writeFileSync(inputPath, inputBuffer);

    // Sticker WhatsApp : WebP animé
    // - 512x512 max
    // - Durée max 6s
    // - fps 15-20
    // - SANS audio
    const cmd =
        `"${FFMPEG_PATH}" -i "${inputPath}" ` +
        `-t 6 ` +
        `-vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" ` +
        `-loop 0 ` +
        `-c:v libwebp -preset default -an -vsync 0 ` +
        `-q:v 70 ` +
        `-threads 1 ` +
        `-y "${outputPath}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 90000, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}

            if (err) {
                console.log('FFmpeg stderr:', stderr?.substring(0, 500));
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                return reject(new Error(`FFmpeg conversion failed: ${err.message}`));
            }

            try {
                const buffer = fs.readFileSync(outputPath);
                fs.unlinkSync(outputPath);
                if (!buffer || buffer.length < 500) {
                    return reject(new Error('Converted WebP is empty'));
                }
                resolve(buffer);
            } catch (e) {
                reject(e);
            }
        });
    });
}

module.exports = {
    name: 'attp',
    aliases: ['attpsticker', 'animatedtext', 'attpvideo'],
    category: 'maker',
    description: 'Generate animated text sticker from text',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Récupérer le texte
        // ─────────────────────────────────
        let text = args.join(' ').trim();

        if (!text) {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                text = quoted.conversation || quoted.extendedTextMessage?.text || '';
            }
        }

        if (!text) {
            return sock.sendMessage(from, {
                text: '✨ *ATTP — Animated Text Sticker*\n\n' +
                      '📌 *Usage:*\n' +
                      '`.attp <text>`\n' +
                      'Or reply to a message with `.attp`\n\n' +
                      '💡 *Examples:*\n' +
                      '`.attp Hello World`\n' +
                      '`.attp Zenitsu`',
            }, { quoted: msg });
        }

        // Limite de longueur
        if (text.length > 50) text = text.substring(0, 50);

        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        try {
            const apiUrl = `${ATTP_API}?text=${encodeURIComponent(text)}`;
            console.log(`🎨 ATTP: "${text}"`);

            // ─────────────────────────────────
            // Requête API : peut retourner JSON ou binaire
            // ─────────────────────────────────
            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                },
            });

            const contentType = response.headers['content-type'] || '';
            let finalBuffer = Buffer.from(response.data);

            // ─────────────────────────────────
            // Cas 1 : réponse JSON avec URL
            // ─────────────────────────────────
            if (contentType.includes('application/json') || contentType.includes('text/')) {
                let jsonData;
                try {
                    jsonData = JSON.parse(finalBuffer.toString());
                } catch (_) {
                    throw new Error('API returned non-JSON text');
                }

                // Chercher l'URL dans plusieurs champs possibles
                const possibleUrl =
                    jsonData.result?.url ||
                    jsonData.result?.video ||
                    jsonData.result?.sticker ||
                    jsonData.url ||
                    jsonData.video ||
                    jsonData.sticker ||
                    jsonData.data?.url ||
                    (typeof jsonData.result === 'string' ? jsonData.result : null);

                if (!possibleUrl || !possibleUrl.startsWith('http')) {
                    console.log('JSON response:', JSON.stringify(jsonData).substring(0, 300));
                    throw new Error('No valid URL in API response');
                }

                console.log(`📥 Downloading media: ${possibleUrl}`);
                const downloaded = await downloadBinary(possibleUrl);
                finalBuffer = downloaded.buffer;
            }

            // ─────────────────────────────────
            // Vérification
            // ─────────────────────────────────
            if (!finalBuffer || finalBuffer.length < 500) {
                throw new Error('Received media is too small or empty');
            }

            // Détecter le type par les magic bytes
            const isWebP = finalBuffer.slice(0, 4).toString('hex') === '52494646' && // RIFF
                          finalBuffer.slice(8, 12).toString('hex') === '57454250';   // WEBP
            const isMp4 = finalBuffer.slice(4, 8).toString('hex') === '66747970';    // ftyp
            const isGif = finalBuffer.slice(0, 6).toString('hex') === '474946383961' ||
                         finalBuffer.slice(0, 6).toString('hex') === '474946383761';

            console.log(`📦 Media detected: WebP=${isWebP} MP4=${isMp4} GIF=${isGif} (size: ${finalBuffer.length} bytes)`);

            // ─────────────────────────────────
            // Si MP4 ou GIF → convertir en WebP
            // ─────────────────────────────────
            if (isMp4 || isGif) {
                console.log('🔄 Converting to animated WebP...');
                try {
                    finalBuffer = await mp4ToWebpSticker(finalBuffer);
                    console.log(`✅ Converted WebP: ${finalBuffer.length} bytes`);
                } catch (convErr) {
                    console.log(`⚠️ WebP conversion failed: ${convErr.message}`);
                    // Fallback : envoyer comme sticker vidéo (isAnimated)
                    await sock.sendMessage(from, {
                        sticker: finalBuffer,
                        isAnimated: true,
                        mimetype: 'video/mp4',
                    });
                    try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}
                    return;
                }
            }

            // ─────────────────────────────────
            // Envoi du sticker
            // ─────────────────────────────────
            if (isWebP) {
                await sock.sendMessage(from, {
                    sticker: finalBuffer,
                    isAnimated: true,
                });
            } else {
                // Fallback : essayer en tant que sticker quelconque
                await sock.sendMessage(from, {
                    sticker: finalBuffer,
                    isAnimated: true,
                });
            }

            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ ATTP error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            let errorMsg = '❌ *ATTP Generation Failed*\n\n';

            if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\nThe API is taking too long.\n\n_Try again in a few moments._';
            } else if (err.message.includes('No valid URL')) {
                errorMsg += '🔗 *API Error*\nThe API did not return a valid media URL.\n\n_Try again later._';
            } else if (err.message.includes('FFmpeg')) {
                errorMsg += '⚙️ *Conversion Error*\nFFmpeg could not convert the media.\n\n_Try again with shorter text._';
            } else {
                errorMsg += `💥 *Error*\n\n${err.message}`;
            }

            await sock.sendMessage(from, { text: errorMsg }, { quoted: msg });
        }
    },
};