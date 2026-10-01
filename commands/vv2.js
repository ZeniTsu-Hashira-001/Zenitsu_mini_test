// ./commands/vv2.js

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

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
// JID UTILS
// ═══════════════════════════════════════

function normalizeJid(jid) {
    if (!jid) return '';
    const [user, server] = jid.split('@');
    const bareUser = user.split(':')[0];
    return server ? `${bareUser}@${server}` : bareUser;
}

function getRawNumber(jid) {
    if (!jid) return '';
    return normalizeJid(jid).split('@')[0];
}

// ═══════════════════════════════════════
// VÉRIFICATION OWNER (via main.js)
// ═══════════════════════════════════════

function isOwnerOfThisBot(sock, senderJid, msg) {
    if (!senderJid) return false;

    // 1. fromMe = toujours owner
    if (msg?.key?.fromMe === true) return true;

    // 2. Le bot lui-même
    const senderRaw = getRawNumber(senderJid);
    const botIds = [];
    if (sock.user?.id)  botIds.push(getRawNumber(sock.user.id));
    if (sock.user?.lid) botIds.push(getRawNumber(sock.user.lid));
    if (botIds.includes(senderRaw)) return true;

    // 3. Via main.js (méthode principale)
    try {
        const main = require('../main.js');

        // Utiliser la méthode complète avec msg
        if (main && typeof main.isOwner === 'function') {
            const result = main.isOwner(sock, senderJid, msg);
            if (result === true) return true;
        }

        // Fallback : vérifier directement les owners du bot
        if (main && typeof main.findBotKey === 'function' && typeof main.isBotOwner === 'function') {
            const key = main.findBotKey(sock);
            if (main.isBotOwner(sock, key, senderJid, msg)) return true;
        }

        // Fallback : CONFIG owner
        if (main?.CONFIG) {
            const ownerJid = main.CONFIG.OWNER_JID ? normalizeJid(main.CONFIG.OWNER_JID) : '';
            const ownerLid = main.CONFIG.OWNER_LID ? normalizeJid(main.CONFIG.OWNER_LID) : '';
            const senderNorm = normalizeJid(senderJid);
            if (ownerJid && senderNorm === ownerJid) return true;
            if (ownerLid && senderNorm === ownerLid) return true;
            if (main.CONFIG.ownerNumber && senderRaw === main.CONFIG.ownerNumber) return true;
        }
    } catch (e) {
        console.log('⚠️ vv2 owner check fallback:', e.message);
    }

    // 4. Fallback : variable d'environnement
    const ownerNumber = process.env.OWNER_NUMBER || process.env.BOT_OWNER || '';
    if (ownerNumber && senderRaw === ownerNumber.replace(/[^0-9]/g, '')) return true;

    return false;
}

// ═══════════════════════════════════════
// RÉCUPÉRATION DE L'OWNER (JID cible)
// ═══════════════════════════════════════

function getOwnerJid(sock, senderJid) {
    // Priorité 1 : CONFIG.OWNER_JID (owner global configuré)
    try {
        const main = require('../main.js');
        if (main?.CONFIG?.OWNER_JID) {
            const jid = normalizeJid(main.CONFIG.OWNER_JID);
            if (jid) return jid;
        }
    } catch (_) {}

    // Priorité 2 : CONFIG.OWNER_LID
    try {
        const main = require('../main.js');
        if (main?.CONFIG?.OWNER_LID) {
            const jid = normalizeJid(main.CONFIG.OWNER_LID);
            if (jid) return jid;
        }
    } catch (_) {}

    // Priorité 3 : env OWNER_NUMBER
    const envOwner = process.env.OWNER_NUMBER || process.env.BOT_OWNER || '';
    if (envOwner) {
        const num = envOwner.replace(/[^0-9]/g, '');
        if (num) return `${num}@s.whatsapp.net`;
    }

    // Priorité 4 : le sender lui-même (s'il est owner)
    if (senderJid) {
        const norm = normalizeJid(senderJid);
        if (norm.includes('@s.whatsapp.net')) return norm;
        if (norm.includes('@lid')) return norm;
    }

    // Priorité 5 : le bot lui-même (dernier recours)
    if (sock.user?.id) {
        const norm = normalizeJid(sock.user.id);
        if (norm.includes('@s.whatsapp.net')) return norm;
    }
    if (sock.user?.lid) {
        return normalizeJid(sock.user.lid);
    }

    return null;
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'vv2',
    aliases: ['viewonce2', 'saveforme', 'vvself'],
    category: 'owner',

    async execute({ sock, msg, args, jid }) {
        const senderJid = msg.key.participant || msg.key.remoteJid;

        // ⭐ OWNER ONLY (silencieux)
        if (!isOwnerOfThisBot(sock, senderJid, msg)) {
            return;
        }

        // ─────────────────────────────────
        // Récupérer le message répond
        // ─────────────────────────────────
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo
            || msg.message?.imageMessage?.contextInfo
            || msg.message?.videoMessage?.contextInfo;

        const quoted = contextInfo?.quotedMessage;

        if (!quoted) return; // Silencieux

        let mediaType = null;
        let mediaMessage = null;

        if (quoted.imageMessage?.viewOnce || quoted.imageMessage?.viewOnceV2) {
            mediaType = 'image';
            mediaMessage = quoted.imageMessage;
        } else if (quoted.videoMessage?.viewOnce || quoted.videoMessage?.viewOnceV2) {
            mediaType = 'video';
            mediaMessage = quoted.videoMessage;
        } else if (quoted.audioMessage?.viewOnce || quoted.audioMessage?.viewOnceV2) {
            mediaType = 'audio';
            mediaMessage = quoted.audioMessage;
        } else {
            return; // Silencieux
        }

        try {
            // ─────────────────────────────────
            // Déterminer le JID cible (owner)
            // ─────────────────────────────────
            const targetJid = getOwnerJid(sock, senderJid);
            if (!targetJid) {
                console.log('❌ vv2: no target JID found');
                return;
            }

            console.log(`📤 vv2: sending to ${targetJid}`);

            // ─────────────────────────────────
            // Télécharger le média
            // ─────────────────────────────────
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            if (!buffer || buffer.length < 100) {
                console.log('❌ vv2: empty buffer');
                return;
            }

            // ─────────────────────────────────
            // Infos du message
            // ─────────────────────────────────
            const caption = mediaMessage.caption || '';
            const senderNumber = getRawNumber(senderJid);
            const chatName = jid.endsWith('@g.us')
                ? `Group: ${jid.split('@')[0]}`
                : 'Private Chat';
            const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
            const savedAt = new Date().toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC';
            const senderMention = senderNumber ? `${senderNumber}@s.whatsapp.net` : null;

            const infoText =
                '👁️ *View-Once Saved*\n\n' +
                `👤 *From:* ${senderMention ? `@${senderNumber}` : 'Unknown'}\n` +
                `💬 *Chat:* ${chatName}\n` +
                `📄 *Type:* ${mediaType.toUpperCase()}\n` +
                (caption ? `📝 *Caption:* ${caption}\n` : '') +
                `📦 *Size:* ${sizeMB} MB\n` +
                `🕒 *Saved:* ${savedAt}\n\n` +
                '⚡ _Zenitsu View-Once Saver_';

            const contextWithMention = {
                ...STYLE,
                mentionedJid: senderMention ? [senderMention] : [],
            };

            // ─────────────────────────────────
            // Envoi selon le type
            // ─────────────────────────────────
            if (mediaType === 'image') {
                await sock.sendMessage(targetJid, {
                    image: buffer,
                    caption: infoText,
                    contextInfo: contextWithMention,
                });
            } else if (mediaType === 'video') {
                await sock.sendMessage(targetJid, {
                    video: buffer,
                    caption: infoText,
                    mimetype: 'video/mp4',
                    contextInfo: contextWithMention,
                });
            } else if (mediaType === 'audio') {
                // Envoyer l'audio d'abord
                await sock.sendMessage(targetJid, {
                    audio: buffer,
                    mimetype: 'audio/mp4',
                    ptt: mediaMessage.ptt || false,
                });
                // Puis les infos
                await sock.sendMessage(targetJid, {
                    text: infoText,
                    contextInfo: contextWithMention,
                });
            }

            // ⭐ AUCUNE réaction, AUCUN message dans le chat d'origine
            console.log(`✅ vv2: media (${mediaType}, ${sizeMB} MB) sent to owner`);

        } catch (err) {
            // Silencieux en cas d'erreur (log uniquement)
            console.error('❌ vv2:', err.message);
        }
    },
};