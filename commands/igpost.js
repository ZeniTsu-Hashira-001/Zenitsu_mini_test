// ./commands/igpost.js

const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ═══════════════════════════════════════
// CONFIG & STYLE
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

const DEFAULT_AVATAR = 'https://files.catbox.moe/w1wsfq.jpg'; // Avatar par défaut si pas de photo de profil

// ═══════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════

async function downloadImageFromMessage(sock, msg) {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) return null;
        const imageMessage = quoted.imageMessage;
        if (!imageMessage) return null;

        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
    } catch (err) {
        console.log('⚠️ Error downloading image from reply:', err.message);
        return null;
    }
}

async function downloadImageFromUrl(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            },
        });
        const buffer = Buffer.from(response.data);
        return buffer.length > 0 ? buffer : null;
    } catch (err) {
        console.log('⚠️ Error downloading image from URL:', err.message);
        return null;
    }
}

async function uploadImageToTemp(buffer) {
    try {
        // Upload vers tmpfiles.org (gratuit et fiable)
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', buffer, {
            filename: `igpost_${Date.now()}.jpg`,
            contentType: 'image/jpeg',
        });
        
        const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
            headers: form.getHeaders(),
            timeout: 30000,
        });
        
        if (response.data?.data?.url) {
            return response.data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
        }
        return null;
    } catch (err) {
        console.log('⚠️ Upload error:', err.message);
        return null;
    }
}

async function getDisplayName(sock, jid) {
    try {
        let name = await sock.getName(jid);
        if (name && /^\d+$/.test(name)) name = null;
        if (name && name.trim().length > 0) return name.trim();
    } catch (_) {}
    
    // Fallback : numéro formaté
    const num = jid.split('@')[0].split(':')[0];
    return `+${num}`;
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'igpost',
    aliases: ['instapost', 'igp', 'fakeigpost'],
    category: 'fun',
    description: 'Create a fake Instagram post',

    async execute({ sock, msg, args, jid }) {
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const from = jid || msg.key.remoteJid;

        // ---- Check if we have an image ----
        let hasQuotedImage = false;
        try {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage) {
                hasQuotedImage = true;
            }
        } catch (_) {}

        // Check for URL in arguments
        let urlImage = null;
        for (const arg of args) {
            if (arg.startsWith('http://') || arg.startsWith('https://')) {
                urlImage = arg;
                break;
            }
        }

        // If no image provided (neither reply nor URL), show help
        if (!hasQuotedImage && !urlImage) {
            return sock.sendMessage(from, {
                text: '❌ *Usage:*\n\n' +
                      'Reply to an image with:\n' +
                      '`.igpost [text] [likes]`\n\n' +
                      'Or provide an image URL:\n' +
                      '`.igpost [text] [likes] [image-url]`\n\n' +
                      '*Examples:*\n' +
                      '`.igpost Hello World` (reply to image)\n' +
                      '`.igpost Hello World 50000 https://example.com/image.jpg`\n' +
                      '`.igpost Hello|50000 https://example.com/image.jpg`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Loading reaction
        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        // ---- Parse arguments ----
        let text = 'Hello';
        let likeCount = 30000;
        let likeText = 'Likes';

        // Remove URL from args for parsing
        const argsWithoutUrl = args.filter(arg => !arg.startsWith('http'));
        
        if (argsWithoutUrl.length > 0) {
            const firstArg = argsWithoutUrl[0];
            if (firstArg.includes('|')) {
                const parts = firstArg.split('|');
                text = parts[0]?.trim() || 'Hello';
                const likesPart = parts[1]?.trim();
                if (likesPart && !isNaN(parseInt(likesPart))) {
                    likeCount = parseInt(likesPart);
                }
            } else {
                text = firstArg.trim();
                // Check if second argument is likes count
                if (argsWithoutUrl[1] && !isNaN(parseInt(argsWithoutUrl[1]))) {
                    likeCount = parseInt(argsWithoutUrl[1]);
                }
            }
        }

        // ---- Get username ----
        const username = await getDisplayName(sock, senderJid);

        // ---- Get avatar ----
        let avatarUrl = DEFAULT_AVATAR;
        try {
            avatarUrl = await sock.profilePictureUrl(senderJid, 'image');
        } catch (_) {
            // Use default avatar
        }

        // ---- Get post image ----
        let postImageUrl = null;

        // Priority 1: Reply with image
        if (hasQuotedImage) {
            const imageBuffer = await downloadImageFromMessage(sock, msg);
            if (imageBuffer) {
                // Upload to temporary service
                postImageUrl = await uploadImageToTemp(imageBuffer);
            }
        }

        // Priority 2: URL in arguments
        if (!postImageUrl && urlImage) {
            // Verify the URL works
            const testBuffer = await downloadImageFromUrl(urlImage);
            if (testBuffer) {
                postImageUrl = urlImage;
            }
        }

        // If still no image, use avatar as fallback
        if (!postImageUrl) {
            postImageUrl = avatarUrl;
        }

        // ---- Build API URL ----
        const apiUrl = `https://api.stellarwa.xyz/generate/instagram?` +
            `username=${encodeURIComponent(username)}` +
            `&avatar=${encodeURIComponent(avatarUrl)}` +
            `&postImage=${encodeURIComponent(postImageUrl)}` +
            `&likeCount=${likeCount}` +
            `&likeText=${encodeURIComponent(likeText)}` +
            `&key=api-HBpdn`;

        try {
            console.log('🎨 Generating Instagram post via Stellar...');
            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            });

            const buffer = Buffer.from(response.data);

            if (!buffer || buffer.length < 1000) {
                throw new Error('Generated image too small or empty');
            }

            // Send generated image
            await sock.sendMessage(from, {
                image: buffer,
                caption: `📸 *Instagram Post*\n\n` +
                         `👤 *User:* ${username}\n` +
                         `❤️ *Likes:* ${likeCount.toLocaleString('en-US')}\n` +
                         `💬 *Caption:* ${text}\n\n` +
                         `⚡ _Generated by Cybernova_`,
                contextInfo: STYLE,
            }, { quoted: msg });

            // Success reaction
            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ IGPost error:', err.message);

            // Error reaction
            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            await sock.sendMessage(from, {
                text: '❌ *Failed to generate Instagram post*\n\n' +
                      `⚠️ Error: ${err.message}\n\n` +
                      '💡 Try again later.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};