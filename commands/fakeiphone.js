// ./commands/fakeiphone.js

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

// API IQC
const IQC_API = 'https://api.deline.web.id/maker/iqc';

// ═══════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════

// Obtenir l'heure actuelle GMT/UTC au format HH:MM
function getCurrentGMTTime() {
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Valider le format d'heure HH:MM
function isValidTime(timeStr) {
    if (!timeStr) return false;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

// Parser les arguments : text|chatTime|statusBarTime
function parseArgs(args) {
    const rawText = args.join(' ').trim();
    
    if (!rawText) {
        return { text: null, chatTime: null, statusBarTime: null };
    }

    const parts = rawText.split('|').map(p => p.trim());
    
    const text = parts[0] || null;
    const chatTime = parts[1] || null;
    const statusBarTime = parts[2] || null;

    return { text, chatTime, statusBarTime };
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'fakeiphone',
    aliases: ['iqc', 'iphonepost', 'fakechat', 'ichat'],
    category: 'maker',
    description: 'Create fake iPhone iMessage chat',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg.key.remoteJid;

        // ─────────────────────────────────
        // Récupérer le texte
        // ─────────────────────────────────
        let rawInput = args.join(' ').trim();

        // Si pas de texte, vérifier si on répond à un message
        if (!rawInput) {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                rawInput = quoted.conversation || quoted.extendedTextMessage?.text || '';
            }
        }

        // Si toujours pas de texte → afficher l'aide
        if (!rawInput) {
            return sock.sendMessage(from, {
                text: '📱 *Fake iPhone Chat (iQC)*\n\n' +
                      '📌 *Usage:*\n' +
                      '`.iqc <text>|<chatTime>|<statusBarTime>`\n\n' +
                      '🎨 *Customization:*\n' +
                      '• *text* — Message content\n' +
                      '• *chatTime* — Time shown in chat (HH:MM)\n' +
                      '• *statusBarTime* — Time in status bar (HH:MM)\n\n' +
                      '💡 *Examples:*\n' +
                      '`.iqc Hello World` — Auto GMT time\n' +
                      '`.iqc Hello|14:30|14:35` — Custom times\n' +
                      '`.iqc Test msg|22:11` — Chat time only\n' +
                      '`.iqc Zenitsu|22:11|22:15` — Full custom\n\n' +
                      '⏰ _If not specified, current GMT time is used_\n\n' +
                      '⚡ _Powered by Cybernova_',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Parser les arguments
        // ─────────────────────────────────
        const { text, chatTime, statusBarTime } = parseArgs([rawInput]);

        if (!text) {
            return sock.sendMessage(from, {
                text: '❌ *No text provided.*\n\nUsage: `.iqc <text>|<chatTime>|<statusBarTime>`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Résolution des heures
        // ─────────────────────────────────
        const currentGMT = getCurrentGMTTime();
        
        let finalChatTime = chatTime;
        let finalStatusBarTime = statusBarTime;

        // Validation et fallback pour chatTime
        if (!finalChatTime || !isValidTime(finalChatTime)) {
            if (finalChatTime && !isValidTime(finalChatTime)) {
                console.log(`⚠️ Invalid chatTime "${finalChatTime}", using GMT: ${currentGMT}`);
            }
            finalChatTime = currentGMT;
        }

        // Validation et fallback pour statusBarTime
        if (!finalStatusBarTime || !isValidTime(finalStatusBarTime)) {
            if (finalStatusBarTime && !isValidTime(finalStatusBarTime)) {
                console.log(`⚠️ Invalid statusBarTime "${finalStatusBarTime}", using GMT: ${currentGMT}`);
            }
            finalStatusBarTime = currentGMT;
        }

        // Loading reaction
        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }); } catch (_) {}

        try {
            // ─────────────────────────────────
            // Appel API IQC
            // ─────────────────────────────────
            const apiUrl = `${IQC_API}?` +
                `text=${encodeURIComponent(text)}` +
                `&chatTime=${encodeURIComponent(finalChatTime)}` +
                `&statusBarTime=${encodeURIComponent(finalStatusBarTime)}`;

            console.log(`📱 IQC: Generating for "${text.substring(0, 30)}..." (chat: ${finalChatTime}, status: ${finalStatusBarTime})`);

            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            const buffer = Buffer.from(response.data);

            if (!buffer || buffer.length < 1000) {
                throw new Error('Generated image is too small or empty');
            }

            // ─────────────────────────────────
            // Envoi de l'image générée
            // ─────────────────────────────────
            await sock.sendMessage(from, {
                image: buffer,
                caption: `📱 *Fake iPhone Chat*\n\n` +
                         `💬 *Text:* ${text}\n` +
                         `🕐 *Chat time:* ${finalChatTime}\n` +
                         `🕐 *Status time:* ${finalStatusBarTime}\n` +
                         `${!chatTime && !statusBarTime ? '⏰ _Using current GMT time_\n' : ''}` +
                         `\n⚡ _Powered by Cybernova_`,
                contextInfo: STYLE,
            }, { quoted: msg });

            // Success reaction
            try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        } catch (err) {
            console.error('❌ IQC error:', err.message);

            try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); } catch (_) {}

            let errorMsg = '❌ *Fake iPhone Generation Failed*\n\n';

            if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\nThe API is taking too long.\n\n_Try again in a few moments._';
            } else if (err.message.includes('too small') || err.message.includes('empty')) {
                errorMsg += '📦 *Invalid response*\nThe API returned an empty or corrupted file.\n\n_Try again with different text._';
            } else {
                errorMsg += `💥 *Error*\n\n${err.message}`;
            }

            await sock.sendMessage(from, {
                text: errorMsg,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};