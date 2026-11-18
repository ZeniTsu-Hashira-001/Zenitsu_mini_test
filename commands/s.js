// ./commands/sticker2.js

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const webp = require('node-webpmux');

const execAsync = promisify(exec);

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const DEFAULT_PACK = '🇿enitsu Mini';
const DEFAULT_AUTHOR = '모🅒🅨🅑🅔🅡🅝🅞🅥🅐 🌟';

const CYBERNOVA_CONTEXT = {
    forwardingScore: 350,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363425394543602@newsletter',
        newsletterName: '모🅒🅨🅑🅔🅡🅝🅞🅥🅐 🌟',
        serverMessageId: 202,
    },
};

// ═══════════════════════════════════════
// LOCATE MEDIA
// ═══════════════════════════════════════

function locateMedia(msg) {
    const m = msg.message || {};
    const types = ['imageMessage', 'videoMessage', 'stickerMessage', 'documentMessage'];

    // Direct media
    for (const t of types) {
        if (m[t]) return { mediaMessage: m, mediaType: t, quotedInfo: null };
    }

    // View-once
    if (m.viewOnceMessage?.message) {
        for (const t of types) {
            if (m.viewOnceMessage.message[t]) return { mediaMessage: m.viewOnceMessage.message, mediaType: t, quotedInfo: null };
        }
    }
    if (m.viewOnceMessageV2?.message) {
        for (const t of types) {
            if (m.viewOnceMessageV2.message[t]) return { mediaMessage: m.viewOnceMessageV2.message, mediaType: t, quotedInfo: null };
        }
    }

    // Quoted message
    const ctx = m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || null;
    let quoted = ctx?.quotedMessage;
    if (quoted) {
        if (quoted.viewOnceMessage?.message) quoted = quoted.viewOnceMessage.message;
        if (quoted.viewOnceMessageV2?.message) quoted = quoted.viewOnceMessageV2.message;
        for (const t of types) {
            if (quoted[t]) return { mediaMessage: quoted, mediaType: t, quotedInfo: ctx };
        }
    }

    return null;
}

// ═══════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════

function buildTargetMessage(originalMsg, located) {
    const { mediaMessage, quotedInfo } = located;
    if (!quotedInfo) return originalMsg;

    return {
        key: {
            remoteJid: originalMsg.key.remoteJid,
            id: quotedInfo.stanzaId || crypto.randomBytes(8).toString('hex'),
            participant: quotedInfo.participant || originalMsg.key.participant || originalMsg.key.remoteJid,
        },
        message: mediaMessage,
    };
}

async function downloadMedia(sock, originalMsg, located) {
    const target = buildTargetMessage(originalMsg, located);
    return await downloadMediaMessage(target, 'buffer', {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
    });
}

// ═══════════════════════════════════════
// CONVERT TO WEBP
// ═══════════════════════════════════════

async function convertToWebp(buffer, mediaMessage, tmpDir) {
    const inputPath = path.join(tmpDir, `input_${Date.now()}`);
    const outputPath = path.join(tmpDir, `sticker_${Date.now()}.webp`);

    fs.writeFileSync(inputPath, buffer);

    const isAnimated = mediaMessage?.mimetype?.includes('gif')
        || mediaMessage?.mimetype?.includes('video')
        || (mediaMessage?.seconds > 0);

    const scale = '512:512';
    const cmd = isAnimated
        ? `ffmpeg -i "${inputPath}" -vf "scale=${scale}:force_original_aspect_ratio=decrease,fps=15,pad=${scale}:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${outputPath}"`
        : `ffmpeg -i "${inputPath}" -vf "scale=${scale}:force_original_aspect_ratio=decrease,format=rgba,pad=${scale}:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${outputPath}"`;

    try {
        await execAsync(cmd, { timeout: 45000 });
    } catch (err) {
        console.error('FFmpeg error:', err.message);
        throw new Error('FFmpeg conversion failed');
    }

    if (!fs.existsSync(outputPath)) throw new Error('Output file not created');

    let webpBuffer = fs.readFileSync(outputPath);

    // Fallback si trop lourd pour les animés
    if (isAnimated && webpBuffer.length > 900 * 1024) {
        try {
            const output2 = path.join(tmpDir, `sticker_small_${Date.now()}.webp`);
            const fileSizeKB = buffer.length / 1024;
            const isLarge = fileSizeKB > 5000;
            const fallbackCmd = isLarge
                ? `ffmpeg -y -i "${inputPath}" -t 2 -vf "scale=320:320:force_original_aspect_ratio=decrease,fps=8,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 100k "${output2}"`
                : `ffmpeg -y -i "${inputPath}" -t 3 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 45 -compression_level 6 -b:v 150k "${output2}"`;
            await execAsync(fallbackCmd, { timeout: 30000 });
            if (fs.existsSync(output2)) {
                webpBuffer = fs.readFileSync(output2);
                try { fs.unlinkSync(output2); } catch (_) {}
            }
        } catch (_) {}
    }

    return webpBuffer;
}

// ═══════════════════════════════════════
// ADD METADATA WITH node-webpmux
// ═══════════════════════════════════════

async function addMetadata(webpBuffer, packname, author) {
    try {
        const img = new webp.Image();
        await img.load(webpBuffer);

        const json = {
            'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
            'sticker-pack-name': packname,
            'sticker-pack-publisher': author,
            'emojis': ['⚡'],
        };

        const exifAttr = Buffer.from([
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
        ]);

        const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuffer]);
        exif.writeUIntLE(jsonBuffer.length, 14, 4);

        img.exif = exif;

        return await img.save(null);
    } catch (err) {
        console.log('⚠️ Metadata injection failed:', err.message);
        return webpBuffer; // Retourne le buffer sans métadonnées
    }
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 's',
    aliases: ['sticker', 'sticker1', 'st'],
    category: 'media',

    async execute({ sock, msg, args, jid }) {
        const located = locateMedia(msg);

        if (!located) {
            return sock.sendMessage(jid, {
                text:
                    '🎨 *Sticker Maker v2*\n\n' +
                    '⚡ *Usage:*\n' +
                    '.s <pack> <author>\n' +
                    'Reply to an image/video/sticker\n\n' +
                    '✨ *Examples:*\n' +
                    '.s Zenitsu Hashira\n' +
                    '.s MyPack MyName\n\n' +
                    '💡 Supports images, videos, GIFs.\n' +
                    '📦 Pack/author visible in sticker info.',
                contextInfo: CYBERNOVA_CONTEXT,
            }, { quoted: msg });
        }

        // Check video duration
        if (located.mediaType === 'videoMessage') {
            const dur = located.mediaMessage?.videoMessage?.seconds || 0;
            if (dur > 11) {
                return sock.sendMessage(jid, {
                    text: '❌ Video too long! Maximum 10 seconds.',
                    contextInfo: CYBERNOVA_CONTEXT,
                }, { quoted: msg });
            }
        }

        // Reaction
        try { await sock.sendMessage(jid, { react: { text: '🎨', key: msg.key } }); } catch (_) {}

        // Temp directory
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker2-'));

        try {
            // Parse packname/author
            const packname = args[0] || DEFAULT_PACK;
            const author = args.slice(1).join(' ') || DEFAULT_AUTHOR;

            // Download media
            const buffer = await downloadMedia(sock, msg, located);
            if (!buffer || buffer.length < 100) throw new Error('Download failed');

            // Get media message for animation detection
            const mediaMsg = located.mediaMessage?.[located.mediaType] || {};

            // Convert to WebP
            const webpBuffer = await convertToWebp(buffer, mediaMsg, tmpDir);
            if (!webpBuffer || webpBuffer.length < 100) throw new Error('Conversion failed');

            // Add metadata (packname/author)
            const finalBuffer = await addMetadata(webpBuffer, packname, author);

            // Send sticker
            await sock.sendMessage(jid, {
                sticker: finalBuffer,
                contextInfo: CYBERNOVA_CONTEXT,
            }, { quoted: msg });

            // Success reaction
            try { await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ sticker2 error:', err.message);
            try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            await sock.sendMessage(jid, {
                text: `❌ Failed: ${err.message}`,
                contextInfo: CYBERNOVA_CONTEXT,
            }, { quoted: msg });
        } finally {
            // Cleanup
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    },
};
