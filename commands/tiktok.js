// ./commands/tiktok.js

const axios = require('axios');

// ═══════════════════════════════════════
// STYLE CYBERNOVA
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
// USER AGENT PROFESSIONNEL
// ═══════════════════════════════════════

function generateUserAgent() {
    const browsers = [
        { name: 'Chrome', version: '125.0.0.0', engine: 'AppleWebKit/537.36' },
        { name: 'Chrome', version: '124.0.0.0', engine: 'AppleWebKit/537.36' },
        { name: 'Firefox', version: '126.0', engine: 'Gecko/20100101' },
        { name: 'Edge', version: '125.0.0.0', engine: 'AppleWebKit/537.36' },
    ];
    const os = [
        'Windows NT 10.0; Win64; x64',
        'Windows NT 11.0; Win64; x64',
        'Macintosh; Intel Mac OS X 10_15_7',
        'X11; Linux x86_64',
    ];
    
    const browser = browsers[Math.floor(Math.random() * browsers.length)];
    const platform = os[Math.floor(Math.random() * os.length)];
    
    if (browser.name === 'Firefox') {
        return `Mozilla/5.0 (${platform}; rv:${browser.version}) Gecko/20100101 Firefox/${browser.version}`;
    }
    
    return `Mozilla/5.0 (${platform}) ${browser.engine} (KHTML, like Gecko) ${browser.name}/${browser.version} Safari/${browser.engine}`;
}

function getHeaders(referer = 'https://www.tiktok.com/') {
    return {
        'User-Agent': generateUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': referer,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    };
}

// ═══════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════

function formatNumber(num) {
    if (!num) return '0';
    if (typeof num === 'string') num = parseInt(num) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatDuration(seconds) {
    if (!seconds) return '0s';
    const s = parseInt(seconds);
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFile(url, timeout = 30000) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: timeout,
            headers: getHeaders(),
            maxRedirects: 5,
        });
        const buffer = Buffer.from(response.data);
        if (!buffer || buffer.length < 1024) {
            throw new Error('File too small or empty');
        }
        return buffer;
    } catch (error) {
        console.error(`❌ Download error ${url}: ${error.message}`);
        throw error;
    }
}

// ═══════════════════════════════════════
// APIs TIKTOK (fallbacks multiples et stables)
// ═══════════════════════════════════════

const TIKTOK_APIS = [
    {
        name: 'TikWM-Primary',
        async fetch(url) {
            const response = await axios.post('https://www.tikwm.com/api/', {
                url: url,
                count: 10,
                cursor: 0,
                web: 1,
                hd: 1,
            }, {
                timeout: 30000,
                headers: {
                    'User-Agent': generateUserAgent(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                },
            });
            
            const data = response.data?.data;
            if (!data || (!data.play && !data.images)) throw new Error('Invalid response');
            
            return {
                type: data.images && data.images.length > 0 ? 'images' : 'video',
                title: data.title || 'No title',
                author: data.author?.unique_id || 'Unknown',
                authorName: data.author?.nickname || 'Unknown',
                authorAvatar: data.author?.avatar || null,
                likes: data.digg_count || 0,
                comments: data.comment_count || 0,
                shares: data.share_count || 0,
                downloads: data.download_count || 0,
                views: data.play_count || 0,
                duration: data.duration || 0,
                musicTitle: data.music_info?.title || 'Unknown music',
                musicAuthor: data.music_info?.author || '',
                musicUrl: data.music || null,
                coverUrl: data.cover || null,
                videoUrl: data.hdplay || data.play || null,
                images: data.images || [],
                noWatermark: !!data.hdplay,
                size: data.size || 0,
            };
        },
    },
    {
        name: 'TikTok-API',
        async fetch(url) {
            const apiUrl = `https://api.tikmate.app/api/v1/tiktok?url=${encodeURIComponent(url)}`;
            const response = await axios.get(apiUrl, {
                timeout: 30000,
                headers: getHeaders('https://tikmate.app/'),
            });
            
            const data = response.data;
            if (!data?.video) throw new Error('Invalid response');
            
            return {
                type: data.images && data.images.length > 0 ? 'images' : 'video',
                title: data.description || 'No title',
                author: data.author?.username || 'Unknown',
                authorName: data.author?.name || 'Unknown',
                authorAvatar: data.author?.avatar || null,
                likes: data.likes || 0,
                comments: data.comments || 0,
                shares: data.shares || 0,
                downloads: data.downloads || 0,
                views: data.views || 0,
                duration: data.duration || 0,
                musicTitle: data.music?.title || 'Unknown music',
                musicAuthor: data.music?.author || '',
                musicUrl: data.music?.url || null,
                coverUrl: data.cover || null,
                videoUrl: data.video || data.video_hd || null,
                images: data.images || [],
                noWatermark: !!data.video_hd,
                size: data.size || 0,
            };
        },
    },
    {
        name: 'DLPanda-Stable',
        async fetch(url) {
            const apiUrl = `https://api.dlpanda.com/v1/tiktok?url=${encodeURIComponent(url)}`;
            const response = await axios.get(apiUrl, {
                timeout: 30000,
                headers: getHeaders('https://dlpanda.com/'),
            });
            
            const data = response.data?.data;
            if (!data || (!data.video && !data.images)) throw new Error('Invalid response');
            
            return {
                type: data.images && data.images.length > 0 ? 'images' : 'video',
                title: data.title || 'No title',
                author: data.author?.username || 'Unknown',
                authorName: data.author?.name || 'Unknown',
                authorAvatar: data.author?.avatar || null,
                likes: data.likes || 0,
                comments: data.comments || 0,
                shares: data.shares || 0,
                downloads: data.downloads || 0,
                views: data.views || 0,
                duration: data.duration || 0,
                musicTitle: data.music?.title || 'Unknown music',
                musicAuthor: data.music?.author || '',
                musicUrl: data.music?.url || null,
                coverUrl: data.cover || null,
                videoUrl: data.video || data.video_hd || null,
                images: data.images || [],
                noWatermark: !!data.video_hd,
                size: data.size || 0,
            };
        },
    },
    {
        name: 'Cobalt-Stable',
        async fetch(url) {
            const response = await axios.post('https://api.cobalt.tools/api/json', {
                url: url,
                videoQuality: 'max',
                audioFormat: 'mp3',
                filenameStyle: 'basic',
            }, {
                timeout: 30000,
                headers: {
                    'User-Agent': generateUserAgent(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            });
            
            const data = response.data;
            if (!data?.url) throw new Error('Invalid response');
            
            return {
                type: 'video',
                title: data.title || 'No title',
                author: 'Unknown',
                authorName: 'Unknown',
                authorAvatar: null,
                likes: 0,
                comments: 0,
                shares: 0,
                downloads: 0,
                views: 0,
                duration: 0,
                musicTitle: 'Unknown music',
                musicAuthor: '',
                musicUrl: null,
                coverUrl: null,
                videoUrl: data.url || null,
                images: [],
                noWatermark: true,
                size: 0,
            };
        },
    },
];

// ═══════════════════════════════════════
// EXTRACTION DIRECTE (Fallback ultime)
// ═══════════════════════════════════════

async function extractDirectFromTikTok(url) {
    try {
        // Essayer d'extraire les données directement de la page TikTok
        const response = await axios.get(url, {
            timeout: 30000,
            headers: getHeaders(),
            maxRedirects: 5,
        });
        
        const html = response.data;
        
        // Chercher le JSON intégré dans la page
        const jsonMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s);
        if (jsonMatch) {
            const jsonData = JSON.parse(jsonMatch[1]);
            const videoData = jsonData?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
            
            if (videoData) {
                return {
                    type: videoData.imagePost ? 'images' : 'video',
                    title: videoData.desc || 'No title',
                    author: videoData.author?.uniqueId || 'Unknown',
                    authorName: videoData.author?.nickname || 'Unknown',
                    authorAvatar: videoData.author?.avatarLarger || null,
                    likes: videoData.stats?.diggCount || 0,
                    comments: videoData.stats?.commentCount || 0,
                    shares: videoData.stats?.shareCount || 0,
                    downloads: videoData.stats?.downloadCount || 0,
                    views: videoData.stats?.playCount || 0,
                    duration: videoData.video?.duration || 0,
                    musicTitle: videoData.music?.title || 'Unknown music',
                    musicAuthor: videoData.music?.authorName || '',
                    musicUrl: videoData.music?.playUrl || null,
                    coverUrl: videoData.video?.cover || null,
                    videoUrl: videoData.video?.playAddr || null,
                    images: videoData.imagePost?.images?.map(img => img.imageURL?.urlList?.[0])?.filter(Boolean) || [],
                    noWatermark: true,
                    size: 0,
                };
            }
        }
        throw new Error('No data extracted');
    } catch (error) {
        console.error('❌ Direct extraction error:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════
// COMMAND PRINCIPALE
// ═══════════════════════════════════════

module.exports = {
    name: 'tiktok',
    aliases: ['tt', 'tik', 'tiktokdl'],
    category: 'downloader',
    description: 'Download TikTok videos without watermark',

    async execute({ sock, msg, args, jid }) {
        const from = jid || msg?.key?.remoteJid;
        const url = args[0];

        if (!from) {
            console.error('❌ JID not available');
            return;
        }

        // Check URL
        if (!url || !url.includes('tiktok.com')) {
            if (msg?.key) {
                await sock.sendMessage(from, { react: { text: "❓", key: msg.key } });
            }
            return sock.sendMessage(from, {
                text: '❌ *Usage:*\n`.tiktok [TikTok link]`\n\n*Examples:*\n`.tiktok https://vm.tiktok.com/xxxxx`\n`.tiktok https://www.tiktok.com/@user/video/123456`',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Loading reaction
        if (msg?.key) {
            await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
        }

        try {
            // Try each API
            let tiktokData = null;
            let usedApi = '';

            for (const api of TIKTOK_APIS) {
                try {
                    console.log(`🎯 Trying API: ${api.name}`);
                    tiktokData = await api.fetch(url);
                    if (tiktokData && (tiktokData.videoUrl || tiktokData.images.length > 0)) {
                        usedApi = api.name;
                        console.log(`✅ API successful: ${api.name}`);
                        break;
                    }
                } catch (err) {
                    console.log(`⚠️ ${api.name} failed: ${err.message}`);
                }
            }

            // Fallback: direct extraction
            if (!tiktokData || (!tiktokData.videoUrl && tiktokData.images.length === 0)) {
                console.log('🎯 Trying direct extraction...');
                tiktokData = await extractDirectFromTikTok(url);
                usedApi = 'Direct Extraction';
            }

            if (!tiktokData || (!tiktokData.videoUrl && tiktokData.images.length === 0)) {
                throw new Error('All TikTok APIs unavailable');
            }

            // Info caption
            const caption = `╭━━━━❲ *TIKTOK DOWNLOAD* ❳━━━━╮
┃
┃  🎵 *Title:*
┃  ${tiktokData.title?.substring(0, 80) || 'No title'}
┃
┃  👤 *Author:*
┃  @${tiktokData.author}
┃
┃  📊 *Statistics:*
┃  • ❤️ Likes: ${formatNumber(tiktokData.likes)}
┃  • 💬 Comments: ${formatNumber(tiktokData.comments)}
┃  • 👁️ Views: ${formatNumber(tiktokData.views)}
┃  • 🔄 Shares: ${formatNumber(tiktokData.shares)}
┃  • 📥 Downloads: ${formatNumber(tiktokData.downloads)}
┃
┃  ⏱️ *Duration:* ${formatDuration(tiktokData.duration)}
┃  🎶 *Music:*
┃  ${tiktokData.musicTitle?.substring(0, 50) || 'Unknown'}
┃
┃  📁 *Type:* ${tiktokData.type === 'images' ? 'Photos (Carousel)' : 'Video'}
┃  💧 *Watermark:* ${tiktokData.noWatermark ? 'Without' : 'With'}
┃  🔧 *API:* ${usedApi}
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

_⚡ Maximum quality • Without watermark_
_©CybernovA_`;

            // Send thumbnail
            if (tiktokData.coverUrl) {
                try {
                    const coverBuffer = await downloadFile(tiktokData.coverUrl, 15000);
                    await sock.sendMessage(from, {
                        image: coverBuffer,
                        caption: caption,
                        contextInfo: STYLE,
                    }, { quoted: msg });
                } catch (err) {
                    console.log('⚠️ Thumbnail failed:', err.message);
                    await sock.sendMessage(from, {
                        text: caption,
                        contextInfo: STYLE,
                    }, { quoted: msg });
                }
            } else {
                await sock.sendMessage(from, {
                    text: caption,
                    contextInfo: STYLE,
                }, { quoted: msg });
            }

            await delay(1500);

            // Handle photos
            if (tiktokData.type === 'images' && tiktokData.images.length > 0) {
                console.log(`📸 Sending ${tiktokData.images.length} photos...`);
                
                const imageBuffers = [];
                const maxImages = Math.min(tiktokData.images.length, 10);
                
                for (let i = 0; i < maxImages; i++) {
                    try {
                        console.log(`📥 Downloading photo ${i + 1}/${maxImages}`);
                        const imgBuffer = await downloadFile(tiktokData.images[i], 20000);
                        imageBuffers.push(imgBuffer);
                        await delay(500);
                    } catch (err) {
                        console.log(`⚠️ Photo ${i + 1} failed: ${err.message}`);
                    }
                }

                if (imageBuffers.length > 0) {
                    for (let i = 0; i < imageBuffers.length; i++) {
                        await sock.sendMessage(from, {
                            image: imageBuffers[i],
                            caption: i === imageBuffers.length - 1
                                ? `📸 *Photo ${i + 1}/${imageBuffers.length}*\n\n_©CybernovA_`
                                : `📸 *Photo ${i + 1}/${imageBuffers.length}*`,
                            contextInfo: STYLE,
                        });
                        await delay(800);
                    }
                }
            }
            // Handle video
            else if (tiktokData.videoUrl) {
                console.log('📹 Sending video...');
                await sock.sendMessage(from, {
                    video: { url: tiktokData.videoUrl },
                    caption: `🎬 *TikTok Video*\n\n👤 @${tiktokData.author}\n🎵 ${tiktokData.musicTitle?.substring(0, 50) || 'Music'}\n⏱️ ${formatDuration(tiktokData.duration)}\n\n━━━━━━━━━━━━━━━\n_©CybernovA_`,
                    mimetype: 'video/mp4',
                    contextInfo: STYLE,
                });
                await delay(1000);
            }

            // Send music separately
            if (tiktokData.musicUrl) {
                console.log('🎵 Sending music...');
                try {
                    const musicBuffer = await downloadFile(tiktokData.musicUrl, 30000);
                    await sock.sendMessage(from, {
                        audio: musicBuffer,
                        mimetype: 'audio/mp4',
                        ptt: false,
                        caption: `🎵 *TikTok Music*\n\n🎶 Title: ${tiktokData.musicTitle}\n👤 Artist: ${tiktokData.musicAuthor || 'Unknown'}\n\n━━━━━━━━━━━━━━━\n_©CybernovA_`,
                        contextInfo: STYLE,
                    });
                } catch (err) {
                    console.log('⚠️ Music not sent:', err.message);
                }
            }

            // Success reaction
            if (msg?.key) {
                await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            }

            // Final confirmation
            await delay(2000);
            const finalMsg = `✅ *Download complete*\n\n` +
                `📊 *Summary:*\n` +
                `• Type: ${tiktokData.type === 'images' ? 'Photos' : 'Video'}\n` +
                `• Duration: ${formatDuration(tiktokData.duration)}\n` +
                `• Size: ${tiktokData.size ? (tiktokData.size / 1024 / 1024).toFixed(2) + ' MB' : 'Not specified'}\n` +
                `• Views: ${formatNumber(tiktokData.views)}\n` +
                `• Likes: ${formatNumber(tiktokData.likes)}\n\n` +
                `_©CybernovA_`;

            await sock.sendMessage(from, {
                text: finalMsg,
                contextInfo: STYLE,
            }, { quoted: msg });

        } catch (err) {
            console.error('❌ TikTok error:', err.message);

            if (msg?.key) {
                await sock.sendMessage(from, { react: { text: "💥", key: msg.key } });
            }

            let errorMsg = '❌ *TikTok Error*\n\n';

            if (err.message.includes('timeout')) {
                errorMsg += '⏰ *Timeout*\nThe server is taking too long to respond.\n\n_Try again in a few moments._';
            } else if (err.message.includes('404') || err.message.includes('not found')) {
                errorMsg += '🔍 *Video not found*\n\nCheck that the link is valid and the video is public.\n\n_Possible causes:_\n• Deleted video\n• Private account\n• Expired link';
            } else if (err.message.includes('403') || err.message.includes('forbidden')) {
                errorMsg += '🚫 *Access denied*\n\nThis video is not publicly accessible.';
            } else if (err.message.includes('All TikTok APIs')) {
                errorMsg += '🔧 *All services are unavailable*\n\n_Try again later._';
            } else {
                errorMsg += `💥 *Technical error*\n\n${err.message}\n\n_Try again later or with another link._`;
            }

            errorMsg += '\n\n━━━━━━━━━━━━━━━\n_©CybernovA_';

            await sock.sendMessage(from, {
                text: errorMsg,
                contextInfo: STYLE,
            }, { quoted: msg });
        }
    },
};