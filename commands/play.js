// ./commands/play.js

const axios = require('axios');

// ═══════════════════════════════════════
// OPTIONAL: ID3 Tagging
// ═══════════════════════════════════════
let NodeID3 = null;
try {
    NodeID3 = require('node-id3');
    console.log('✅ node-id3 loaded');
} catch (_) {
    console.log('ℹ️ node-id3 not installed — ID3 tags will be skipped');
    console.log('   Install with: npm install node-id3');
}

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const MAX_DURATION_SECONDS = 600;       // 10 min max
const MAX_FILE_SIZE_MB = 16;            // WhatsApp audio limit
const FALLBACK_THUMB = 'https://iili.io/COzVllj.jpg';
const SEARCH_TTL_MS = 5 * 60 * 1000;    // 5 minutes

const activeSearches = new Map();

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
// UTILS
// ═══════════════════════════════════════

function parseDuration(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const s = String(str).trim();
    const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return (parseInt(m[1]) || 0) * 3600 + (parseInt(m[2]) || 0) * 60 + (parseInt(m[3]) || 0);
    return 0;
}

function formatDuration(sec) {
    if (!sec || sec <= 0) return 'Unknown';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function truncate(str, max = 200) {
    if (!str) return '';
    const s = String(str).trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function isValidUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// ═══════════════════════════════════════
// SEARCH APIs
// ═══════════════════════════════════════

const SEARCH_APIS = [
    {
        name: 'NexRay',
        fn: async (q) => {
            const { data } = await axios.get(
                `https://api.nexray.eu.cc/search/youtube?q=${encodeURIComponent(q)}`,
                { timeout: 15000 }
            );
            return (data?.result || []).map(r => ({
                title: r.title || '',
                url: r.url || `https://youtube.com/watch?v=${r.id}`,
                videoId: r.id || '',
                duration: r.duration || '',
                durationSeconds: r.seconds || parseDuration(r.duration),
                views: r.views || '',
                thumbnail: r.image_url || '',
                channel: r.channel || '',
                channelUrl: r.channel_url || '',
                description: r.description || '',
                uploadedAt: r.upload_at || '',
                source: 'NexRay',
            }));
        },
    },
    {
        name: 'DavidCyril',
        fn: async (q) => {
            const { data } = await axios.get(
                `https://apis.davidcyriltech.my.id/youtube/search?query=${encodeURIComponent(q)}`,
                { timeout: 15000 }
            );
            return (data?.results || []).map(r => ({
                title: r.title || '',
                url: `https://youtube.com/watch?v=${r.videoId}`,
                videoId: r.videoId || '',
                duration: r.duration || '',
                durationSeconds: parseDuration(r.duration),
                views: r.views?.toString() || '',
                thumbnail: r.thumbnail || '',
                channel: r.author?.name || r.channel || '',
                channelUrl: r.author?.url || '',
                description: r.description || '',
                uploadedAt: r.ago || '',
                source: 'DavidCyril',
            }));
        },
    },
    {
        name: 'Yupra',
        fn: async (q) => {
            const { data } = await axios.get(
                `https://api.yupra.my.id/api/search/youtube?q=${encodeURIComponent(q)}`,
                { timeout: 15000 }
            );
            return (data?.results || []).map(r => ({
                title: r.title || '',
                url: r.url || `https://www.youtube.com/watch?v=${r.videoId}`,
                videoId: r.videoId || '',
                duration: r.duration || '',
                durationSeconds: r.seconds || parseDuration(r.duration),
                views: r.views || '',
                thumbnail: r.image_url || r.thumbnail || '',
                channel: r.author?.name || r.channel || '',
                channelUrl: r.author?.url || '',
                description: r.description || '',
                uploadedAt: r.ago || '',
                source: 'Yupra',
            }));
        },
    },
    {
        name: 'ZellAPI',
        fn: async (q) => {
            const { data } = await axios.get(
                `https://zellapi.autos/search/youtube?q=${encodeURIComponent(q)}`,
                { timeout: 15000 }
            );
            return (data?.result || []).map(r => ({
                title: r.title || '',
                url: r.url || `https://youtube.com/watch?v=${r.id}`,
                videoId: r.id || '',
                duration: r.duration || '',
                durationSeconds: parseDuration(r.duration),
                views: r.views || '',
                thumbnail: r.thumbnail || r.image_url || '',
                channel: r.channel || '',
                channelUrl: r.channel_url || '',
                description: r.description || '',
                uploadedAt: r.upload_at || '',
                source: 'ZellAPI',
            }));
        },
    },
    {
        name: 'GiftedTech',
        fn: async (q) => {
            const { data } = await axios.get(
                `https://api.giftedtech.co.ke/api/search/yts?apikey=gifted&query=${encodeURIComponent(q)}`,
                { timeout: 15000 }
            );
            let results = data?.result || data?.results || (Array.isArray(data) ? data : []);
            return results.map(r => ({
                title: r.title || r.name || '',
                url: r.url || r.link || '',
                videoId: r.videoId || r.video_id || '',
                duration: r.duration || r.timestamp || '',
                durationSeconds: parseDuration(r.duration || r.timestamp),
                views: r.views || r.view_count || '',
                thumbnail: r.image_url || r.thumbnail || '',
                channel: r.author?.name || r.channel || '',
                channelUrl: r.author?.url || '',
                description: r.description || '',
                uploadedAt: r.ago || '',
                source: 'GiftedTech',
            }));
        },
    },
];

// ═══════════════════════════════════════
// DOWNLOAD APIs
// ═══════════════════════════════════════

const DOWNLOAD_APIS = [
    {
        name: 'NexRay YTPlay',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://api.nexray.eu.cc/downloader/ytplay?q=${encodeURIComponent(url)}`,
                { timeout: 40000 }
            );
            const r = data?.result || {};
            return {
                downloadUrl: r.download_url || '',
                title: r.title || '',
                artist: r.channel || '',
                thumbnail: r.thumbnail || '',
                duration: r.seconds || 0,
                views: r.views || '',
                uploadedAt: r.upload_at || '',
            };
        },
    },
    {
        name: 'NeoSoft',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://api.neosoft.best/api/downloader/youtube-play?q=${encodeURIComponent(url)}&type=mp3`,
                { timeout: 40000 }
            );
            return {
                downloadUrl: data?.download || '',
                title: data?.title || '',
                artist: data?.artist || '',
                thumbnail: data?.thumbnail || '',
                duration: data?.duration || 0,
            };
        },
    },
    {
        name: 'NexRay YTMP3',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://api.nexray.eu.cc/downloader/ytmp3?url=${encodeURIComponent(url)}`,
                { timeout: 40000 }
            );
            const r = data?.result || {};
            return {
                downloadUrl: r.download_url || '',
                title: r.title || '',
                artist: r.channel || '',
                thumbnail: r.thumbnail || '',
                duration: r.seconds || 0,
            };
        },
    },
    {
        name: 'DavidCyril YTMP3',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://apis.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(url)}`,
                { timeout: 40000 }
            );
            const r = data?.result || {};
            return {
                downloadUrl: r.download_url || '',
                title: r.title || '',
                artist: r.author || '',
                thumbnail: r.thumbnail || '',
            };
        },
    },
    {
        name: 'Sylphy V2',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://sylphyy.xyz/download/v2/ytmp3?url=${encodeURIComponent(url)}`,
                { timeout: 40000 }
            );
            const r = data?.result || {};
            return {
                downloadUrl: r.dl_url || '',
                title: r.title || '',
                artist: r.artist || '',
                thumbnail: r.thumbnail || '',
            };
        },
    },
    {
        name: 'PrinceTech',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://api.princetechn.com/api/download/ytmp3?apikey=prince&url=${encodeURIComponent(url)}`,
                { timeout: 40000 }
            );
            const r = data?.result || {};
            return {
                downloadUrl: r.download_url || r.url || '',
                title: r.title || '',
                artist: r.artist || '',
                thumbnail: r.thumbnail || '',
            };
        },
    },
    {
        name: 'GiftedTech',
        fn: async (url) => {
            const { data } = await axios.get(
                `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(url)}`,
                { timeout: 40000 }
            );
            const r = data?.result || data || {};
            return {
                downloadUrl: r.download_url || r.url || r.link || '',
                title: r.title || '',
                artist: r.artist || '',
                thumbnail: r.thumbnail || '',
            };
        },
    },
];

// ═══════════════════════════════════════
// ID3 TAGGING
// ═══════════════════════════════════════

async function tagMp3WithMetadata(audioBuffer, metadata) {
    if (!NodeID3) return audioBuffer;

    try {
        const tags = {
            title: truncate(metadata.title, 100),
            artist: truncate(metadata.artist, 100),
            album: 'Zenitsu Music',
            comment: {
                language: 'eng',
                text: 'Downloaded by Zenitsu Bot',
            },
        };

        // Ajouter la pochette (cover)
        if (metadata.coverUrl) {
            try {
                const coverRes = await axios.get(metadata.coverUrl, {
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                const coverBuffer = Buffer.from(coverRes.data);

                // Vérifier la taille (max 1 MB pour la pochette)
                if (coverBuffer.length > 0 && coverBuffer.length < 1024 * 1024) {
                    tags.image = {
                        mime: 'image/jpeg',
                        type: { id: 3, name: 'front cover' },
                        description: 'Cover',
                        imageBuffer: coverBuffer,
                    };
                }
            } catch (err) {
                console.log(`⚠️ Cover fetch failed: ${err.message}`);
            }
        }

        const tagged = NodeID3.write(tags, audioBuffer);
        console.log(`✅ ID3 tags applied: ${tags.title} by ${tags.artist}`);
        return tagged;
    } catch (err) {
        console.log(`⚠️ ID3 tagging failed: ${err.message}`);
        return audioBuffer;
    }
}

// ═══════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════

module.exports = {
    name: 'play',
    aliases: ['ytmp3', 'music', 'song', 'youtube', 'yts', 'yta'],
    category: 'downloader',

    async execute({ sock, msg, args, jid }) {
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const input = args.join(' ').trim();

        // Aide
        if (!input) {
            return sock.sendMessage(jid, {
                text:
                    '🎵 *YouTube Music Downloader*\n\n' +
                    '⚡ *Usage:*\n' +
                    '• `.play <song name>` — Search\n' +
                    '• `.play <number>` — Download result\n\n' +
                    '✨ *Examples:*\n' +
                    '• `.play Spectre Alan Walker`\n' +
                    '• `.play 1`\n\n' +
                    '🔄 Multiple sources with fallback\n' +
                    '📁 Files tagged with cover + metadata',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // ─────────────────────────────────
        // Download by number
        // ─────────────────────────────────
        const numberMatch = input.match(/^(\d+)$/);
        if (numberMatch) {
            const selectedIndex = parseInt(numberMatch[1]) - 1;
            const stored = activeSearches.get(senderJid);

            if (!stored?.results?.length) {
                return sock.sendMessage(jid, {
                    text: '⚠️ *No active search.*\n\nUse `.play <song name>` first.',
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            if (Date.now() - stored.timestamp > SEARCH_TTL_MS) {
                activeSearches.delete(senderJid);
                return sock.sendMessage(jid, {
                    text: '⚠️ *Search expired.*\n\nPlease search again.',
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            if (selectedIndex < 0 || selectedIndex >= stored.results.length) {
                return sock.sendMessage(jid, {
                    text: `⚠️ *Invalid number.*\n\nChoose between 1 and ${stored.results.length}.`,
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            const selected = stored.results[selectedIndex];
            return await downloadMusic(sock, msg, jid, selected);
        }

        // ─────────────────────────────────
        // Search
        // ─────────────────────────────────
        try { await sock.sendMessage(jid, { react: { text: '🔍', key: msg.key } }); } catch (_) {}

        let results = null;
        let searchSource = '';

        for (const api of SEARCH_APIS) {
            try {
                console.log(`🔍 Search: ${api.name}...`);
                const res = await api.fn(input);
                if (res?.length) {
                    results = res;
                    searchSource = api.name;
                    console.log(`✅ Search OK: ${api.name} (${res.length} results)`);
                    break;
                }
            } catch (err) {
                console.log(`⚠️ ${api.name}: ${err.message}`);
            }
        }

        if (!results?.length) {
            try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            return sock.sendMessage(jid, {
                text: '❌ *No results found.*\n\nTry different keywords.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Filtrer les vidéos ≤ 10 min et garder 5 résultats
        const filtered = results.filter(r => !r.durationSeconds || r.durationSeconds <= MAX_DURATION_SECONDS);
        const final = (filtered.length >= 3 ? filtered : results).slice(0, 5);

        // Sauvegarder pour la sélection numérique
        activeSearches.set(senderJid, { results: final, timestamp: Date.now() });

        // ═══════════════════════════════════
        // AFFICHAGE AMÉLIORÉ AVEC HEADER
        // (image du 1er résultat + infos complètes)
        // ═══════════════════════════════════
        const first = final[0];
        const thumb = first.thumbnail || FALLBACK_THUMB;

        let caption = `🎵 *YouTube Music Search*\n\n`;
        caption += `🔍 *Query:* ${truncate(input, 60)}\n`;
        caption += `🎼 *Source:* ${searchSource}\n`;
        caption += `📊 *Results:* ${final.length}\n`;
        caption += `\n━━━━━━━━━━━━━━━\n\n`;

        final.forEach((r, i) => {
            caption += `*${i + 1}.* ${truncate(r.title, 80)}\n`;

            if (r.channel)   caption += `   📺 ${truncate(r.channel, 50)}\n`;
            if (r.durationSeconds) caption += `   ⏱ ${formatDuration(r.durationSeconds)}\n`;
            if (r.views)     caption += `   👁 ${r.views}\n`;
            if (r.uploadedAt) caption += `   📅 ${r.uploadedAt}\n`;

            caption += `\n`;
        });

        caption += `━━━━━━━━━━━━━━━\n\n`;
        caption += `📌 *Reply:* \`.play <number>\`\n`;
        caption += `⏳ *Expires:* 5 minutes\n\n`;
        caption += `⚡ _Powered by Zenitsu AI_`;

        // Envoyer avec l'image du premier résultat en header
        try {
            await sock.sendMessage(jid, {
                image: { url: thumb },
                caption,
                contextInfo: STYLE,
            }, { quoted: msg });
        } catch (imgErr) {
            console.log(`⚠️ Header image failed: ${imgErr.message}`);
            await sock.sendMessage(jid, {
                text: caption,
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        try { await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }); } catch (_) {}

        // Nettoyage automatique
        setTimeout(() => {
            const stored = activeSearches.get(senderJid);
            if (stored && Date.now() - stored.timestamp >= SEARCH_TTL_MS) {
                activeSearches.delete(senderJid);
            }
        }, SEARCH_TTL_MS + 1000);
    },
};

// ═══════════════════════════════════════
// DOWNLOAD MUSIC
// ═══════════════════════════════════════

async function downloadMusic(sock, msg, jid, track) {
    // ─────────────────────────────────
    // Progress message
    // ─────────────────────────────────
    const progressMsg = await sock.sendMessage(jid, {
        text:
            `⏳ *Preparing download...*\n\n` +
            `🎵 *Track:* ${truncate(track.title, 80)}\n` +
            `📺 *Channel:* ${truncate(track.channel || 'Unknown', 60)}\n` +
            `⏱ *Duration:* ${formatDuration(track.durationSeconds)}\n\n` +
            `_Please wait..._`,
        contextInfo: STYLE,
    }, { quoted: msg });

    try { await sock.sendMessage(jid, { react: { text: '⬇️', key: msg.key } }); } catch (_) {}

    // ─────────────────────────────────
    // Download from multiple sources
    // ─────────────────────────────────
    let dlResult = null;
    let usedApi = '';

    for (const api of DOWNLOAD_APIS) {
        try {
            console.log(`⬇️ Trying ${api.name}...`);
            const result = await api.fn(track.url);

            if (result?.downloadUrl && isValidUrl(result.downloadUrl)) {
                dlResult = result;
                usedApi = api.name;
                console.log(`✅ Download OK: ${api.name}`);
                break;
            }
            console.log(`⚠️ ${api.name}: invalid URL`);
        } catch (err) {
            console.log(`⚠️ ${api.name}: ${err.message}`);
        }
    }

    if (!dlResult?.downloadUrl) {
        try { await sock.sendMessage(jid, { delete: progressMsg.key }); } catch (_) {}
        try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
        return sock.sendMessage(jid, {
            text:
                '❌ *All download sources failed.*\n\n' +
                '💡 *Try:*\n' +
                '• A different song\n' +
                '• A shorter video (<10 min)\n' +
                '• Again in a few minutes',
            contextInfo: STYLE,
        }, { quoted: msg });
    }

    // ─────────────────────────────────
    // Download audio file
    // ─────────────────────────────────
    let audioBuffer = null;
    let sizeMB = 0;

    try {
        console.log(`📥 Downloading audio: ${dlResult.downloadUrl.substring(0, 100)}...`);

        const audioRes = await axios.get(dlResult.downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'audio/mpeg,audio/*,*/*',
            },
        });

        audioBuffer = Buffer.from(audioRes.data);
        sizeMB = audioBuffer.length / 1048576;

        console.log(`✅ Audio: ${sizeMB.toFixed(2)} MB`);

        if (sizeMB > MAX_FILE_SIZE_MB) {
            throw new Error(`File too large (${sizeMB.toFixed(1)} MB > ${MAX_FILE_SIZE_MB} MB)`);
        }
    } catch (err) {
        console.log(`❌ Audio download: ${err.message}`);
        try { await sock.sendMessage(jid, { delete: progressMsg.key }); } catch (_) {}
        try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
        return sock.sendMessage(jid, {
            text:
                '❌ *Failed to download audio.*\n\n' +
                `⚠️ ${err.message}`,
            contextInfo: STYLE,
        }, { quoted: msg });
    }

    // ─────────────────────────────────
    // Prepare metadata
    // ─────────────────────────────────
    const title = dlResult.title || track.title || 'Unknown';
    const artist = dlResult.artist || track.channel || 'YouTube Music';
    const thumbnail = dlResult.thumbnail || track.thumbnail || FALLBACK_THUMB;
    const duration = track.durationSeconds || dlResult.duration || 0;

    // ─────────────────────────────────
    // Embed ID3 tags (title, artist, cover)
    // ─────────────────────────────────
    console.log('🏷️ Applying ID3 tags...');
    const taggedBuffer = await tagMp3WithMetadata(audioBuffer, {
        title,
        artist,
        coverUrl: thumbnail,
    });

    // ─────────────────────────────────
    // Send audio with externalAdReply (header preview)
    // ─────────────────────────────────
    try {
        console.log(`📤 Sending audio: ${title}`);

        await sock.sendMessage(jid, {
            audio: taggedBuffer,
            mimetype: 'audio/mpeg',
            ptt: false,
            fileName: `${truncate(title, 60)}.mp3`,
            contextInfo: {
                externalAdReply: {
                    title: truncate(title, 100),
                    body: truncate(artist, 100),
                    thumbnailUrl: thumbnail,
                    sourceUrl: track.url || '',
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    showAdAttribution: false,
                },
            },
        }, { quoted: msg });

        console.log(`✅ Audio sent`);

        // Supprimer le message de progression
        try { await sock.sendMessage(jid, { delete: progressMsg.key }); } catch (_) {}

        // Envoyer un récapitulatif compact
        const summary =
            `🎵 *${truncate(title, 80)}*\n` +
            `🎤 ${truncate(artist, 60)}\n` +
            `⏱ ${formatDuration(duration)} • 📦 ${sizeMB.toFixed(2)} MB\n` +
            `🔧 ${usedApi}`;

        await sock.sendMessage(jid, {
            text: summary,
            contextInfo: STYLE,
        }, { quoted: msg });

        try { await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }); } catch (_) {}

    } catch (err) {
        console.log(`❌ Send error: ${err.message}`);
        try { await sock.sendMessage(jid, { delete: progressMsg.key }); } catch (_) {}
        try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
        return sock.sendMessage(jid, {
            text:
                '❌ *Failed to send audio.*\n\n' +
                `⚠️ ${err.message}`,
            contextInfo: STYLE,
        }, { quoted: msg });
    }
}