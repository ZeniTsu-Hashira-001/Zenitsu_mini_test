// ./commands/get.js

const fs = require('fs');
const path = require('path');

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
    let num = jid.split('@')[0];
    num = num.split(':')[0];
    return num.trim();
}

// ═══════════════════════════════════════
// VÉRIFICATION OWNER
// ═══════════════════════════════════════

function isBotOwner(sock, senderJid) {
    if (!senderJid) return false;

    const senderRaw = getRawNumber(senderJid);
    const senderNormalized = normalizeJid(senderJid);

    const botIds = [];
    if (sock.user?.id) {
        botIds.push(normalizeJid(sock.user.id));
        botIds.push(getRawNumber(sock.user.id));
    }
    if (sock.user?.lid) {
        botIds.push(normalizeJid(sock.user.lid));
        botIds.push(getRawNumber(sock.user.lid));
    }

    if (botIds.includes(senderNormalized) || botIds.includes(senderRaw)) {
        return true;
    }

    try {
        const main = require('../main.js');
        if (main && typeof main.isBotOwner === 'function') {
            let botKey = 'main';
            if (sock.user?.id) {
                const rawNumber = getRawNumber(sock.user.id);
                if (rawNumber && rawNumber !== CONFIG?.ownerNumber) {
                    botKey = rawNumber;
                }
            }
            return main.isBotOwner(sock, botKey, senderJid);
        }
    } catch (_) {}

    if (global.subBots && global.subBots instanceof Map) {
        for (const [subNumber, subData] of global.subBots) {
            if (subData.sock === sock) {
                const subState = global.botStates?.get(subNumber);
                if (subState && subState.owners) {
                    for (const owner of subState.owners) {
                        if (normalizeJid(owner) === senderNormalized) {
                            return true;
                        }
                    }
                }
                break;
            }
        }
    }

    const ownerNumber = process.env.OWNER_NUMBER || '50935729494';
    if (senderRaw === ownerNumber || senderNormalized === `${ownerNumber}@s.whatsapp.net`) {
        return true;
    }

    try {
        const main = require('../main.js');
        if (main && main.CONFIG && main.CONFIG.OWNER_LID) {
            const ownerLid = normalizeJid(main.CONFIG.OWNER_LID);
            if (senderNormalized === ownerLid || getRawNumber(senderNormalized) === getRawNumber(ownerLid)) {
                return true;
            }
        }
    } catch (_) {}

    return false;
}

// ═══════════════════════════════════════
// RECHERCHE DE TOUS LES FICHIERS CORRESPONDANTS
// ═══════════════════════════════════════

// Ordre de priorité : command, event, util, root
const SEARCH_DIRS = [
    { dir: 'commands', type: 'command', icon: '⚡', label: 'CMD' },
    { dir: 'events',   type: 'event',   icon: '🎯', label: 'EVENT' },
    { dir: 'utils',    type: 'util',    icon: '🔧', label: 'UTIL' },
];

function findAllMatches(name) {
    const searchName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const matches = [];

    for (const { dir, type, icon, label } of SEARCH_DIRS) {
        const dirPath = path.join(process.cwd(), dir);
        if (!fs.existsSync(dirPath)) continue;

        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const baseName = file.replace('.js', '').toLowerCase();
            if (baseName === searchName) {
                matches.push({
                    path: path.join(dirPath, file),
                    type,
                    icon,
                    label,
                    name: file.replace('.js', ''),
                    fileName: file,
                });
            }
        }
    }

    // main.js à la racine
    if (searchName === 'main') {
        const mainPath = path.join(process.cwd(), 'main.js');
        if (fs.existsSync(mainPath)) {
            matches.push({
                path: mainPath,
                type: 'root',
                icon: '📦',
                label: 'ROOT',
                name: 'main',
                fileName: 'main.js',
            });
        }
    }

    return matches;
}

// ═══════════════════════════════════════
// LISTE DES FICHIERS DISPONIBLES
// ═══════════════════════════════════════

function listAvailableFiles() {
    const files = [];
    const dirs = ['commands', 'events', 'utils'];

    for (const dir of dirs) {
        const dirPath = path.join(process.cwd(), dir);
        if (fs.existsSync(dirPath)) {
            const items = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));
            for (const item of items) {
                files.push({ name: item.replace('.js', ''), type: dir });
            }
        }
    }

    if (fs.existsSync(path.join(process.cwd(), 'main.js'))) {
        files.push({ name: 'main', type: 'root' });
    }

    return files;
}

// ═══════════════════════════════════════
// PARSING DES ARGUMENTS
// ═══════════════════════════════════════

// Formats supportés :
//   .get <name>             → 1er match, document
//   .get <name> <num>       → Nième match, document
//   .get 2 <name>           → 1er match, texte
//   .get 2 <name> <num>     → Nième match, texte
//   .get 1 <name>           → 1er match, document (explicite)
function parseGetArgs(args) {
    let formatMode = 'document'; // 'document' ou 'text'
    let matchIndex = 0;          // 0-based
    const nameParts = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const isNumber = /^\d+$/.test(arg);

        // Premier argument : mode de format (1=doc, 2=texte)
        if (i === 0 && isNumber) {
            const mode = parseInt(arg);
            if (mode === 1) formatMode = 'document';
            else if (mode === 2) formatMode = 'text';
            continue;
        }

        // Dernier argument numérique : index du match
        if (i === args.length - 1 && isNumber && nameParts.length > 0) {
            matchIndex = Math.max(0, parseInt(arg) - 1);
            continue;
        }

        // Sinon c'est une partie du nom
        nameParts.push(arg);
    }

    return {
        formatMode,
        matchIndex,
        name: nameParts.join(' ').trim(),
    };
}

// ═══════════════════════════════════════
// ENVOI EN TEXTE (avec découpage si trop long)
// ═══════════════════════════════════════

const MAX_TEXT_CHUNK = 12000; // Limite WhatsApp ~65000, on garde une marge

async function sendCodeAsText(sock, jid, code, fileInfo, msg) {
    const lines = code.split('\n').length;
    const sizeKB = (Buffer.byteLength(code) / 1024).toFixed(2);

    // Header
    await sock.sendMessage(jid, {
        text:
            `${fileInfo.icon} *Source Code — ${fileInfo.label}*\n\n` +
            `📄 *File:* ${fileInfo.fileName}\n` +
            `📁 *Type:* ${fileInfo.type}\n` +
            `📏 *Size:* ${sizeKB} KB\n` +
            `📊 *Lines:* ${lines}\n` +
            `📝 *Mode:* Text\n\n` +
            `_Sending below..._`,
        contextInfo: STYLE,
    }, { quoted: msg });

    // Découper si trop long
    if (code.length <= MAX_TEXT_CHUNK) {
        await sock.sendMessage(jid, {
            text: '```javascript\n' + code + '\n```',
        });
    } else {
        let offset = 0;
        let part = 1;
        const totalParts = Math.ceil(code.length / MAX_TEXT_CHUNK);

        while (offset < code.length) {
            const chunk = code.substring(offset, offset + MAX_TEXT_CHUNK);
            await sock.sendMessage(jid, {
                text: `*Part ${part}/${totalParts}*\n\`\`\`javascript\n${chunk}\n\`\`\``,
            });
            offset += MAX_TEXT_CHUNK;
            part++;
            // Petit délai pour éviter le spam
            await new Promise(r => setTimeout(r, 800));
        }
    }
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'get',
    aliases: ['getcode', 'source', 'src', 'code'],
    category: 'owner',

    async execute({ sock, msg, args, jid, senderJid }) {
        // Vérifier si l'utilisateur est owner
        if (!isBotOwner(sock, senderJid)) {
            return;
        }

        // ─────────────────────────────────
        // Sans arguments : liste des fichiers
        // ─────────────────────────────────
        if (!args || args.length === 0) {
            const files = listAvailableFiles();

            if (files.length === 0) {
                return sock.sendMessage(jid, {
                    text: '📂 *No source files found.*',
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            const grouped = {};
            for (const file of files) {
                if (!grouped[file.type]) grouped[file.type] = [];
                grouped[file.type].push(file.name);
            }

            let response = '📂 *Available Source Files*\n\n';
            for (const [type, names] of Object.entries(grouped)) {
                response += `📁 *${type}*\n`;
                response += names.sort().map(n => `  • ${n}`).join('\n');
                response += '\n\n';
            }

            response +=
                '💡 *Usage:*\n' +
                '• `.get <name>` — 1st match, document\n' +
                '• `.get <name> 2` — 2nd match (e.g. event), document\n' +
                '• `.get 2 <name>` — 1st match, text in chat\n' +
                '• `.get 2 <name> 2` — 2nd match, text\n\n' +
                '📝 *Examples:*\n' +
                '• `.get welcome` (command)\n' +
                '• `.get welcome 2` (event)\n' +
                '• `.get 2 play` (text)\n' +
                '• `.get 2 welcome 2` (event as text)';

            return sock.sendMessage(jid, {
                text: response,
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Parse arguments
        // ─────────────────────────────────
        const { formatMode, matchIndex, name } = parseGetArgs(args);

        if (!name) {
            return sock.sendMessage(jid, {
                text: '❌ *No file name provided.*\n\nUsage: `.get [1|2] <name> [index]`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Recherche des correspondances
        // ─────────────────────────────────
        const matches = findAllMatches(name);

        if (matches.length === 0) {
            const files = listAvailableFiles();
            const similar = files
                .filter(f => f.name.toLowerCase().includes(name.toLowerCase()))
                .map(f => f.name);

            let message = `❌ *File not found:* ${name}`;
            if (similar.length > 0) {
                message += `\n\n💡 *Did you mean?*\n${similar.slice(0, 5).map(f => `• .get ${f}`).join('\n')}`;
            }

            return sock.sendMessage(jid, {
                text: message,
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Index hors limites
        // ─────────────────────────────────
        if (matchIndex >= matches.length) {
            let message = `❌ *Index ${matchIndex + 1} out of range*\n\n`;
            message += `Found *${matches.length}* match(es) for "${name}":\n\n`;
            matches.forEach((m, i) => {
                message += `*${i + 1}.* ${m.icon} ${m.label} → \`${m.fileName}\`\n`;
            });
            message += `\n💡 *Usage:* .get ${name} ${matchIndex + 1}`;

            return sock.sendMessage(jid, {
                text: message,
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Sélection du fichier
        // ─────────────────────────────────
        const fileInfo = matches[matchIndex];

        try {
            const code = fs.readFileSync(fileInfo.path, 'utf8');
            const sizeKB = (Buffer.byteLength(code) / 1024).toFixed(2);
            const lines = code.split('\n').length;

            // ─────────────────────────────────
            // MODE TEXTE
            // ─────────────────────────────────
            if (formatMode === 'text') {
                await sendCodeAsText(sock, jid, code, fileInfo, msg);
                return;
            }

            // ─────────────────────────────────
            // MODE DOCUMENT (défaut)
            // ─────────────────────────────────
            let infoLine = '';
            if (matches.length > 1) {
                infoLine = `🔖 *Match:* ${matchIndex + 1}/${matches.length}\n`;
            }

            await sock.sendMessage(jid, {
                document: Buffer.from(code, 'utf8'),
                mimetype: 'application/javascript',
                fileName: fileInfo.fileName,
                caption:
                    `${fileInfo.icon} *Source Code — ${fileInfo.label}*\n\n` +
                    `📄 *File:* ${fileInfo.fileName}\n` +
                    `📁 *Type:* ${fileInfo.type}\n` +
                    infoLine +
                    `📏 *Size:* ${sizeKB} KB\n` +
                    `📊 *Lines:* ${lines}\n\n` +
                    '⚡ _Zenitsu_',
                contextInfo: STYLE,
            }, { quoted: msg });

        } catch (err) {
            console.error('❌ get error:', err.message);

            return sock.sendMessage(jid, {
                text: `❌ *Error reading file:* ${err.message}`,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};