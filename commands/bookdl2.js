// ./commands/bookdl.js

const axios = require('axios');

// ═══════════════════════════════════════
// CONFIGURATION & STYLES
// ═══════════════════════════════════════

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB max pour WhatsApp
const TIMEOUT = 60000; // 60 secondes max pour télécharger
const CHUNK_SIZE = 60000; // Limite de caractères par message WhatsApp

const STYLE = {
    forwardingScore: 350,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363425394543602@newsletter',
        newsletterName: '모🅒🅨🅑🅔🅡🅝🅞🅥🅐 🌟',
        serverMessageId: 202,
    },
};

// Fonction pour introduire un délai (évite les bugs et surcharges)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Découper le texte si on doit l'envoyer en plusieurs messages
const chunkText = (text, length) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += length) {
        chunks.push(text.slice(i, i + length));
    }
    return chunks;
};

// ═══════════════════════════════════════
// SOURCES DE RECHERCHE (Légales & Scientifiques)
// ═══════════════════════════════════════

const BOOK_SOURCES = [
    {
        name: 'OpenAlex (Scientific & Academic Papers)',
        search: async (query, lang) => {
            // Filtre par langue et documents en accès libre (Open Access)
            const langFilter = lang && lang !== 'en' ? `,language:${lang}` : '';
            const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=has_oa_accepted_or_published_version:true${langFilter}&per-page=3`;
            const { data } = await axios.get(url, { timeout: 15000 });
            
            return (data.results || []).map(work => {
                const pdfUrl = work.open_access?.oa_url;
                if (!pdfUrl) return null;
                return {
                    title: work.title || 'Unknown Scientific Paper',
                    author: work.authorships?.[0]?.author?.display_name || 'Various Authors',
                    url: pdfUrl,
                    ext: pdfUrl.endsWith('.pdf') ? 'pdf' : 'pdf',
                    txtUrl: null, // Pas de TXT natif pour les PDF OpenAlex
                    source: 'OpenAlex (Science)',
                    abstract: work.abstract_inverted_index ? 'Abstract available on the link.' : ''
                };
            }).filter(Boolean);
        }
    },
    {
        name: 'Project Gutenberg (Classic Books & Literature)',
        search: async (query, lang) => {
            const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}&languages=${lang || 'en'}`;
            const { data } = await axios.get(url, { timeout: 15000 });
            
            return (data.results || []).slice(0, 3).map(book => {
                const formats = book.formats || {};
                const epub = formats['application/epub+zip'];
                const pdf = formats['application/pdf'];
                const txt = formats['text/plain'] || formats['text/plain; charset=us-ascii'] || formats['text/plain; charset=utf-8'];
                
                const fileUrl = epub || pdf || txt;
                if (!fileUrl) return null;

                return {
                    title: book.title,
                    author: book.authors?.[0]?.name || 'Unknown',
                    url: fileUrl,
                    ext: fileUrl.includes('epub') ? 'epub' : fileUrl.includes('pdf') ? 'pdf' : 'txt',
                    txtUrl: txt, // Toujours garder le lien texte sous la main pour le fallback
                    source: 'Project Gutenberg'
                };
            }).filter(Boolean);
        }
    },
    {
        name: 'Google Books (Public Domain)',
        search: async (query, lang) => {
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&langRestrict=${lang || 'en'}&maxResults=3&filter=free-ebooks`;
            const { data } = await axios.get(url, { timeout: 15000 });
            
            return (data.items || []).map(item => {
                const access = item.accessInfo;
                const info = item.volumeInfo || {};
                const pdf = access.pdf?.isAvailable ? access.pdf.downloadLink : null;
                const epub = access.epub?.isAvailable ? access.epub.downloadLink : null;
                
                const fileUrl = pdf || epub;
                if (!fileUrl) return null;

                return {
                    title: info.title || 'Unknown',
                    author: info.authors?.join(', ') || 'Unknown',
                    url: fileUrl,
                    ext: pdf ? 'pdf' : 'epub',
                    txtUrl: null,
                    source: 'Google Books'
                };
            }).filter(Boolean);
        }
    }
];

// ═══════════════════════════════════════
// COMMAND EXECUTION
// ═══════════════════════════════════════

module.exports = {
    name: 'bookdl2',
    aliases: ['bdl2', 'getbook2', 'ebook2'],
    category: 'downloader',

    async execute({ sock, msg, args, jid }) {
        let rawQuery = args.join(' ').trim();

        if (!rawQuery) {
            return sock.sendMessage(jid, {
                text:
                    '📖 *Advanced Book & Science Downloader*\n\n' +
                    '⚡ *Usage:*\n' +
                    '`.bookdl2 [lang] <title / author / subject>`\n\n' +
                    '✨ *Examples:*\n' +
                    '`.bookdl2 fr Le prince Machiavel` (French)\n' +
                    '`.bdl2 ht Moby Dick` (Haitian Creole)\n' +
                    '`.bookdl2 black holes` (English by default)\n\n' +
                    '📚 *Sources:* OpenAlex (Science), Gutenberg, Google Books\n' +
                    '📦 *Max:* 3 Results | Text Fallback if download fails.',
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Vérification de la langue (ex: "fr le prince" -> lang: "fr", query: "le prince")
        let lang = 'en'; // Langue par défaut
        const langMatch = rawQuery.match(/^([a-zA-Z]{2})\s+(.+)$/);
        
        if (langMatch) {
            lang = langMatch[1].toLowerCase();
            rawQuery = langMatch[2];
        }

        try { await sock.sendMessage(jid, { react: { text: '🔍', key: msg.key } }); } catch (_) {}

        let collectedResults = [];

        // 1. Recherche via toutes les sources avec délai
        for (const source of BOOK_SOURCES) {
            if (collectedResults.length >= 3) break; // Limite à 3 résultats globaux

            try {
                console.log(`[BOOKDL] Searching in ${source.name} for "${rawQuery}" (Lang: ${lang})...`);
                const results = await source.search(rawQuery, lang);
                
                for (const res of results) {
                    if (collectedResults.length < 3 && !collectedResults.some(r => r.url === res.url)) {
                        collectedResults.push(res);
                    }
                }
            } catch (err) {
                console.log(`[BOOKDL] ⚠️ Error with ${source.name}: ${err.message}`);
            }

            await sleep(1500); // Délai requis pour la stabilité
        }

        // Aucun résultat trouvé
        if (collectedResults.length === 0) {
            try { await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }); } catch (_) {}
            return sock.sendMessage(jid, {
                text: `❌ *No Book/Paper Found*\n\nCould not find any legal free document for: *${rawQuery}* (Language: ${lang.toUpperCase()}).\n\nTry using different keywords or language codes.`,
                contextInfo: STYLE,
            }, { quoted: msg });
        }

        // Indication de téléchargement
        await sock.sendMessage(jid, {
            text: `✅ *Found ${collectedResults.length} result(s).* Processing downloads...`,
            contextInfo: STYLE
        }, { quoted: msg });

        try { await sock.sendMessage(jid, { react: { text: '⬇️', key: msg.key } }); } catch (_) {}

        // 2. Traitement et Envoi des résultats
        for (let i = 0; i < collectedResults.length; i++) {
            const book = collectedResults[i];
            let downloadSuccess = false;

            try {
                // Vérifier la taille avant de télécharger
                const headReq = await axios.head(book.url, { timeout: 10000 }).catch(() => null);
                const size = headReq ? Number(headReq.headers['content-length'] || 0) : 0;

                if (size > 0 && size <= MAX_SIZE) {
                    const response = await axios.get(book.url, {
                        responseType: 'arraybuffer',
                        timeout: TIMEOUT,
                        maxContentLength: MAX_SIZE
                    });

                    const buffer = Buffer.from(response.data);
                    const safeName = book.title.replace(/[^a-z0-9\s-]/gi, '').trim().slice(0, 60);

                    const mimeMap = {
                        'epub': 'application/epub+zip',
                        'pdf': 'application/pdf',
                        'txt': 'text/plain',
                    };

                    await sock.sendMessage(jid, {
                        document: buffer,
                        mimetype: mimeMap[book.ext] || 'application/octet-stream',
                        fileName: `${safeName}.${book.ext}`,
                        caption: `📄 *Result ${i + 1}/${collectedResults.length}*\n\n📌 *Title:* ${book.title}\n✍️ *Author:* ${book.author}\n📚 *Source:* ${book.source}\n\n⚡ _Zenitsu_`,
                        contextInfo: STYLE,
                    }, { quoted: msg });

                    downloadSuccess = true;
                }
            } catch (error) {
                console.log(`[BOOKDL] ⚠️ Failed to download as document: ${book.title}`);
            }

            // 3. Fallback (Si le fichier est trop gros ou échoue)
            if (!downloadSuccess) {
                if (book.txtUrl) {
                    // Repli : Télécharger le texte brut et le diviser
                    try {
                        const txtRes = await axios.get(book.txtUrl, { responseType: 'text', timeout: 20000 });
                        const fullText = txtRes.data;
                        const chunks = chunkText(fullText, CHUNK_SIZE);

                        await sock.sendMessage(jid, {
                            text: `⚠️ *File too large or failed to send as Document.*\nSending *${book.title}* as Text (${chunks.length} parts)...`,
                            contextInfo: STYLE
                        }, { quoted: msg });

                        for (let j = 0; j < chunks.length; j++) {
                            await sleep(1000); // Délai entre les parties
                            await sock.sendMessage(jid, {
                                text: `📖 *${book.title}* (Part ${j + 1}/${chunks.length})\n\n${chunks[j]}`,
                                contextInfo: STYLE
                            }, { quoted: msg });
                        }
                    } catch (txtError) {
                        // Échec total du texte
                        await sock.sendMessage(jid, {
                            text: `❌ *Failed to fetch full text.*\n\n📌 *Title:* ${book.title}\n🔗 *Read here:* ${book.url}`,
                            contextInfo: STYLE
                        }, { quoted: msg });
                    }
                } else {
                    // Repli : Si aucun texte brut n'est disponible (ex: PDF pur sans OCR dispo)
                    await sock.sendMessage(jid, {
                        text: `⚠️ *File too large or format unsupported for direct bot transmission.*\n\n📌 *Title:* ${book.title}\n✍️ *Author:* ${book.author}\n📚 *Source:* ${book.source}\n\n🔗 *Download/Read Manually:* ${book.url}`,
                        contextInfo: STYLE
                    }, { quoted: msg });
                }
            }

            await sleep(2000); // Délai entre l'envoi des différents livres
        }

        try { await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }); } catch (_) {}
    },
};
