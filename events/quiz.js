// ./events/quiz.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ═══════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════

const QUIZ_DIR = path.join(process.cwd(), 'database', 'quiz');
const LANGUAGES = {
    fr: 'fr', en: 'en', es: 'es', de: 'de', it: 'it', pt: 'pt',
    ar: 'ar', ru: 'ru', ja: 'ja', zh: 'zh', ht: 'ht', ko: 'ko',
};
const DEFAULT_LANG = 'fr';
const QUESTIONS_PER_QUIZ = 10; // Réduit pour éviter les bugs
const MAX_PARTICIPANTS = 20;
const MIN_PARTICIPANTS = 2;
const JOIN_WAIT_MS = 60_000;        // 60 secondes pour rejoindre
const QUESTION_TIME_MS = 15_000;    // 15 secondes par question (au lieu de 10)
const INTER_QUESTION_MS = 5_000;    // 5 secondes entre questions (réduit)
const FAKE_TYPING_MS = 2_000;       // 2 secondes de fake typing (réduit)

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
// SESSIONS ACTIVES (par chat)
// ═══════════════════════════════════════

const sessions = new Map();

function getSession(chatJid) {
    return sessions.get(chatJid) || null;
}

function createSession(chatJid, topic, lang, questions) {
    const session = {
        chatJid,
        topic,
        lang,
        questions,
        currentIndex: 0,
        participants: new Set(),        // JIDs des participants ready
        scores: new Map(),              // JID -> points
        answers: new Map(),             // JID -> { answer, timestamp }
        status: 'waiting',              // waiting, playing, finished, cancelled
        questionTimer: null,
        joinTimer: null,
        interQuestionTimer: null,
        fakeTypingTimer: null,
        starter: null,                  // JID du lanceur
        questionStartTime: 0,           // Timestamp du début de la question
        correctAnswer: null,            // Bonne réponse (1-based)
        questionAnswered: false,        // Flag pour éviter les doubles réponses
    };
    sessions.set(chatJid, session);
    return session;
}

function deleteSession(chatJid) {
    const s = sessions.get(chatJid);
    if (s) {
        clearTimeout(s.questionTimer);
        clearTimeout(s.joinTimer);
        clearTimeout(s.interQuestionTimer);
        clearTimeout(s.fakeTypingTimer);
    }
    sessions.delete(chatJid);
}

// ═══════════════════════════════════════
// TRADUCTION (avec fallback)
// ═══════════════════════════════════════

async function translate(text, targetLang) {
    if (targetLang === DEFAULT_LANG || !text) return text;

    try {
        const { data } = await axios.get(
            `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`,
            { timeout: 8000 }
        );
        const translated = data?.[0]?.map(seg => seg[0]).join('');
        if (translated && translated !== text) return translated;
    } catch (_) {}

    try {
        const { data } = await axios.get(
            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=fr|${targetLang}`,
            { timeout: 8000 }
        );
        if (data?.responseData?.translatedText) {
            return data.responseData.translatedText;
        }
    } catch (_) {}

    return text;
}

async function translateBatch(texts, targetLang) {
    const results = [];
    for (const t of texts) {
        results.push(await translate(t, targetLang));
        await new Promise(r => setTimeout(r, 100));
    }
    return results;
}

// ═══════════════════════════════════════
// CHARGEMENT DES QUESTIONS
// ═══════════════════════════════════════

function loadQuestions(topic) {
    const filePath = path.join(QUIZ_DIR, `${topic.toLowerCase()}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(data) ? data : null;
    } catch (_) {
        return null;
    }
}

function getAvailableTopics() {
    if (!fs.existsSync(QUIZ_DIR)) return [];
    return fs.readdirSync(QUIZ_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ═══════════════════════════════════════
// FONCTIONS D'ENVOI
// ═══════════════════════════════════════

async function sendMessage(sock, jid, text, mentions = []) {
    try {
        return await sock.sendMessage(jid, {
            text,
            contextInfo: {
                mentionedJid: mentions.length ? mentions : [],
                ...STYLE,
            },
        });
    } catch (err) {
        console.error('❌ Quiz sendMessage error:', err.message);
        return null;
    }
}

async function sendTyping(sock, jid) {
    try {
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, FAKE_TYPING_MS));
        await sock.sendPresenceUpdate('available', jid);
    } catch (_) {}
}

// ═══════════════════════════════════════
// RÉSOLUTION DU NOM D'UTILISATEUR
// ═══════════════════════════════════════

async function getDisplayName(sock, jid) {
    try {
        // Essayer d'obtenir le nom via le contact
        let name = null;
        
        // Méthode 1 : sock.getName()
        try {
            name = await sock.getName(jid);
        } catch (_) {}

        // Méthode 2 : contact dans le message
        if (!name || /^\d+$/.test(name)) {
            try {
                const contact = await sock.getContact(jid);
                if (contact?.name && !/^\d+$/.test(contact.name)) {
                    name = contact.name;
                } else if (contact?.notify && !/^\d+$/.test(contact.notify)) {
                    name = contact.notify;
                }
            } catch (_) {}
        }

        // Vérification finale
        if (name && name.trim().length > 0 && !/^\d+$/.test(name.trim())) {
            return name.trim();
        }
    } catch (_) {}

    // Fallback : numéro de téléphone formaté
    const num = jid.split('@')[0].split(':')[0];
    return `+${num}`;
}

function getMentionJid(jid) {
    // Convertir en format @s.whatsapp.net pour les mentions
    const raw = jid.split('@')[0].split(':')[0];
    return `${raw}@s.whatsapp.net`;
}

// ═══════════════════════════════════════
// GESTION DU QUIZ
// ═══════════════════════════════════════

function getOptions(question) {
    const fakes = [];
    for (let i = 1; i <= 10; i++) {
        const fake = question[`fa${i}`];
        if (fake && typeof fake === 'string' && fake.trim().length > 0) {
            fakes.push(fake);
        }
    }
    const selectedFakes = shuffleArray(fakes).slice(0, 4);
    const all = [question.a, ...selectedFakes];
    return shuffleArray(all);
}

async function sendQuestion(sock, session) {
    try {
        // Vérifier si on a encore des questions valides
        while (session.currentIndex < session.questions.length) {
            const q = session.questions[session.currentIndex];
            
            // Valider la question
            if (!q || !q.q1 || !q.a || typeof q.q1 !== 'string' || typeof q.a !== 'string') {
                console.log('⚠️ Question invalide, passage à la suivante');
                session.currentIndex++;
                continue;
            }

            const opts = getOptions(q);
            if (opts.length < 2 || !opts.includes(q.a)) {
                console.log('⚠️ Options invalides, passage à la suivante');
                session.currentIndex++;
                continue;
            }

            const correctIndex = opts.indexOf(q.a);
            session.correctAnswer = correctIndex + 1;
            session.questionAnswered = false;
            session.answers.clear();
            session.questionStartTime = Date.now();

            // Traduction
            let questionText = q.q1;
            let optionTexts = opts;
            
            if (session.lang !== DEFAULT_LANG) {
                try {
                    const translated = await translateBatch([q.q1, ...opts], session.lang);
                    questionText = translated[0] || q.q1;
                    optionTexts = translated.slice(1).map((t, i) => t || opts[i]);
                } catch (_) {
                    // Utiliser les textes originaux
                }
            }

            let msg = `📝 *Question ${session.currentIndex + 1}/${session.questions.length}*\n\n`;
            msg += `${questionText}\n\n`;

            optionTexts.forEach((opt, i) => {
                msg += `${i + 1}${String.fromCharCode(0x20E3)} ${opt}\n`;
            });

            msg += `\n⏳ *15 secondes pour répondre !*\n`;
            msg += `_Envoyez le numéro de votre réponse (1-${opts.length})_`;

            await sendMessage(sock, session.chatJid, msg, [...session.participants].map(getMentionJid));

            // Timer de question
            if (session.questionTimer) clearTimeout(session.questionTimer);
            session.questionTimer = setTimeout(async () => {
                await handleQuestionEnd(sock, session);
            }, QUESTION_TIME_MS);

            return;
        }

        // Plus de questions valides
        if (session.currentIndex >= session.questions.length) {
            await endQuiz(sock, session);
        }
    } catch (err) {
        console.error('❌ sendQuestion error:', err.message);
        session.currentIndex++;
        if (session.currentIndex < session.questions.length) {
            await sendQuestion(sock, session);
        } else {
            await endQuiz(sock, session);
        }
    }
}

async function handleQuestionEnd(sock, session) {
    // Empêcher double appel
    if (session.questionAnswered) return;
    session.questionAnswered = true;

    if (session.questionTimer) {
        clearTimeout(session.questionTimer);
        session.questionTimer = null;
    }

    const correct = session.correctAnswer;
    const correctResponders = [];

    // Analyser les réponses
    for (const [jid, answer] of session.answers.entries()) {
        if (answer === correct) {
            correctResponders.push(jid);
        }
    }

    // Attribution des points
    const pointsMap = new Map();
    correctResponders.forEach((jid, index) => {
        let points;
        if (index === 0) points = 5;
        else if (index === 1) points = 3;
        else points = 1;
        
        pointsMap.set(jid, points);
        session.scores.set(jid, (session.scores.get(jid) || 0) + points);
    });

    // Création du message de résultats
    let resultMsg = `✅ *Bonne réponse : ${correct}*\n\n`;

    if (correctResponders.length > 0) {
        resultMsg += `🏆 *Gagnants :*\n`;
        const mentions = [];
        
        for (const [jid, points] of pointsMap.entries()) {
            const displayName = await getDisplayName(sock, jid);
            resultMsg += `• ${displayName} : +${points} pts\n`;
            mentions.push(getMentionJid(jid));
        }

        resultMsg += `\n📊 *Score actuel :*\n`;
        const sortedScores = [...session.scores.entries()].sort((a, b) => b[1] - a[1]);
        const medals = ['🥇', '🥈', '🥉'];
        
        for (let i = 0; i < sortedScores.length; i++) {
            const [jid, score] = sortedScores[i];
            const displayName = await getDisplayName(sock, jid);
            const medal = i < 3 ? medals[i] + ' ' : '';
            resultMsg += `${medal}${displayName} : ${score} pts\n`;
        }

        await sendMessage(sock, session.chatJid, resultMsg, mentions);
    } else {
        resultMsg += `😅 *Personne n'a trouvé la bonne réponse !*\n\n`;
        resultMsg += `📊 *Score actuel :*\n`;
        const sortedScores = [...session.scores.entries()].sort((a, b) => b[1] - a[1]);
        
        if (sortedScores.length > 0) {
            const medals = ['🥇', '🥈', '🥉'];
            for (let i = 0; i < sortedScores.length; i++) {
                const [jid, score] = sortedScores[i];
                const displayName = await getDisplayName(sock, jid);
                const medal = i < 3 ? medals[i] + ' ' : '';
                resultMsg += `${medal}${displayName} : ${score} pts\n`;
            }
        } else {
            resultMsg += `_Aucun score pour le moment_`;
        }

        await sendMessage(sock, session.chatJid, resultMsg, []);
    }

    // Passer à la question suivante
    session.interQuestionTimer = setTimeout(async () => {
        session.currentIndex++;
        if (session.currentIndex >= session.questions.length) {
            await endQuiz(sock, session);
        } else {
            await sendTyping(sock, session.chatJid);
            await sendQuestion(sock, session);
        }
    }, INTER_QUESTION_MS);
}

async function endQuiz(sock, session) {
    if (session.status === 'finished') return;
    session.status = 'finished';

    const sorted = [...session.scores.entries()].sort((a, b) => b[1] - a[1]);
    let finalMsg = '🏁 *Quiz terminé !*\n\n';
    const medals = ['🥇', '🥈', '🥉'];
    const mentions = [];

    if (sorted.length > 0) {
        for (let i = 0; i < sorted.length; i++) {
            const [jid, score] = sorted[i];
            const displayName = await getDisplayName(sock, jid);
            const medal = i < 3 ? medals[i] + ' ' : '';
            finalMsg += `${medal}${displayName} : ${score} pts\n`;
            mentions.push(getMentionJid(jid));
        }
    } else {
        finalMsg += '_Aucun participant_';
    }

    await sendMessage(sock, session.chatJid, finalMsg, mentions);
    deleteSession(session.chatJid);
}

// ═══════════════════════════════════════
// GESTION DES MESSAGES (réponses, ready, stop)
// ═══════════════════════════════════════

async function quizMessageHandler(sock, update) {
    if (!update.messages) return;
    for (const msg of update.messages) {
        if (!msg.message) continue;
        const chatJid = msg.key.remoteJid;
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';
        if (!text) continue;

        const session = getSession(chatJid);
        if (!session) continue;

        const lower = text.trim().toLowerCase();

        // Commandes spéciales pour le lanceur
        if (session.starter === senderJid && lower === 'quiz stop') {
            await sock.sendMessage(chatJid, { text: '🛑 *Quiz annulé.*' });
            deleteSession(chatJid);
            continue;
        }

        if (session.status === 'waiting') {
            if (lower === 'quiz ready' || lower === 'ready') {
                if (!session.participants.has(senderJid) && session.participants.size < MAX_PARTICIPANTS) {
                    session.participants.add(senderJid);
                    session.scores.set(senderJid, 0);
                    try {
                        await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
                    } catch (_) {}
                }
            }
            continue;
        }

        if (session.status === 'playing') {
            // Accepter uniquement les numéros 1-5
            const num = parseInt(text.trim());
            if (!isNaN(num) && num >= 1 && num <= 5 && !session.questionAnswered) {
                if (!session.answers.has(senderJid)) {
                    session.answers.set(senderJid, num);
                    try {
                        await sock.sendMessage(chatJid, { react: { text: '📝', key: msg.key } });
                    } catch (_) {}
                }
            }
            continue;
        }
    }
}

// ═══════════════════════════════════════
// AFFICHAGE DE L'AIDE
// ═══════════════════════════════════════

async function showQuizHelp(sock, jid, msg) {
    const topics = getAvailableTopics();
    const languages = Object.keys(LANGUAGES).join(', ');
    const prefix = global.PREFIX || '.';

    let helpText = `📚 *QUIZ COMMAND*\n\n`;
    helpText += `*Usage:*\n`;
    helpText += `${prefix}quiz <langue> <sujet>\n`;
    helpText += `${prefix}quiz <sujet>\n\n`;
    helpText += `*Exemples:*\n`;
    helpText += `${prefix}quiz anime\n`;
    helpText += `${prefix}quiz fr histoire\n`;
    helpText += `${prefix}quiz en science\n\n`;

    if (topics.length > 0) {
        helpText += `📁 *Sujets disponibles:*\n`;
        helpText += topics.join(', ') + '\n\n';
    } else {
        helpText += `📁 *Sujets disponibles:* Aucun\n\n`;
    }

    helpText += `🌐 *Langues disponibles:*\n`;
    helpText += languages + '\n\n';
    helpText += `❓ *Questions:* ${QUESTIONS_PER_QUIZ} par quiz\n`;
    helpText += `⏳ *Temps par question:* 15 secondes\n`;
    helpText += `👥 *Participants:* ${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS}\n\n`;
    helpText += `🎮 *Comment jouer:*\n`;
    helpText += `1. Lancez avec ${prefix}quiz <sujet>\n`;
    helpText += `2. Les participants envoient "quiz ready"\n`;
    helpText += `3. Répondez avec le numéro (1-5)\n`;
    helpText += `4. Le lanceur peut arrêter avec "quiz stop"`;

    return sock.sendMessage(jid, {
        text: helpText,
        contextInfo: STYLE,
    }, { quoted: msg });
}

// ═══════════════════════════════════════
// COMMANDE QUIZ
// ═══════════════════════════════════════

async function quizCommand(sock, msg, args, jid) {
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');

    if (!isGroup) {
        return sock.sendMessage(jid, { text: '❌ Le quiz se joue uniquement en groupe.' });
    }

    // Si pas d'arguments, afficher l'aide
    if (args.length === 0) {
        return await showQuizHelp(sock, jid, msg);
    }

    // Vérifier qu'il n'y a pas de session active
    if (getSession(jid)) {
        return sock.sendMessage(jid, { text: '⚠️ *Un quiz est déjà en cours dans ce chat.*' });
    }

    // Parser les arguments : [langue] [sujet]
    let lang = DEFAULT_LANG;
    let topic = '';
    let topicStartIndex = 0;

    if (args.length > 0 && LANGUAGES[args[0].toLowerCase()]) {
        lang = LANGUAGES[args[0].toLowerCase()];
        topicStartIndex = 1;
    }

    topic = args.slice(topicStartIndex).join(' ').toLowerCase().trim();

    if (!topic) {
        return await showQuizHelp(sock, jid, msg);
    }

    // Charger les questions
    let questions = loadQuestions(topic);
    if (!questions || questions.length === 0) {
        const topics = getAvailableTopics();
        return sock.sendMessage(jid, {
            text: `❌ *Aucune question trouvée pour le sujet "${topic}".*\n\n` +
                  `📁 *Sujets disponibles:*\n${topics.length > 0 ? topics.join(', ') : 'Aucun'}`,
            contextInfo: STYLE,
        });
    }

    // Filtrer les questions valides
    questions = questions.filter(q => 
        q && q.q1 && q.a && 
        typeof q.q1 === 'string' && typeof q.a === 'string' &&
        q.q1.trim().length > 0 && q.a.trim().length > 0
    );

    if (questions.length < MIN_PARTICIPANTS) {
        return sock.sendMessage(jid, {
            text: `❌ *Pas assez de questions valides pour le sujet "${topic}".*`,
            contextInfo: STYLE,
        });
    }

    // Créer la session
    const selectedQuestions = shuffleArray(questions).slice(0, Math.min(QUESTIONS_PER_QUIZ, questions.length));
    const session = createSession(jid, topic, lang, selectedQuestions);
    session.starter = senderJid;
    session.participants.add(senderJid);
    session.scores.set(senderJid, 0);

    await sock.sendMessage(jid, {
        text:
            `🎯 *Quiz lancé !*\n\n` +
            `📚 *Sujet:* ${topic}\n` +
            `🌐 *Langue:* ${lang}\n` +
            `❓ *Questions:* ${session.questions.length}\n` +
            `⏳ *Temps par question:* 15 secondes\n` +
            `👥 *Participants requis:* ${MIN_PARTICIPANTS} minimum\n\n` +
            `🔹 Envoyez *quiz ready* pour participer.\n` +
            `🔹 Le lanceur peut arrêter avec *quiz stop*.\n` +
            `⏳ *60 secondes pour rejoindre...*`,
        contextInfo: STYLE,
    }, { quoted: msg });

    // Timer pour la fin de la période d'inscription
    session.joinTimer = setTimeout(async () => {
        if (session.participants.size < MIN_PARTICIPANTS) {
            await sock.sendMessage(jid, {
                text: `❌ *Pas assez de participants.*\n` +
                      `Minimum requis: ${MIN_PARTICIPANTS}. Quiz annulé.`,
                contextInfo: STYLE,
            });
            deleteSession(jid);
            return;
        }

        // Démarrer le jeu
        session.status = 'playing';
        await sock.sendMessage(jid, {
            text: `✅ *${session.participants.size} participants !*\n` +
                  `🎮 Début du quiz dans quelques secondes...`,
            contextInfo: STYLE,
        });
        
        await sendTyping(sock, jid);
        await sendQuestion(sock, session);
    }, JOIN_WAIT_MS);
}

// ═══════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════

module.exports = {
    event: 'messages.upsert',
    execute: quizMessageHandler,
    name: 'quiz',
    command: quizCommand,
};