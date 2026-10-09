import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 8787);
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const strictOllamaOnly = (process.env.OLLAMA_STRICT || 'true').toLowerCase() === 'true';

const TOPIC_LABELS = ['Reisen', 'Arbeit', 'Essen', 'Hobbys', 'Technik', 'Alltag'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLatestUserMessage(messages) {
  if (!Array.isArray(messages)) {
    return '';
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && typeof message.text === 'string') {
      return normalizeText(message.text);
    }
  }

  return '';
}

function extractKeywords(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\säöüß]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 4);
}

function buildFollowUp(topicLabel, keywords, turnCount) {
  const keywordText = keywords.length > 0 ? `Du hast ${keywords.join(', ')} erwähnt.` : 'Deine Antwort klingt interessant.';

  const topicFollowUps = {
    Reisen: [
      'Was war dabei das Schönste für dich?',
      'Würdest du dort noch einmal hinfahren?',
      'Was würdest du beim nächsten Mal anders machen?',
    ],
    Arbeit: [
      'Was daran war für dich am wichtigsten?',
      'Wie würdest du das im Alltag verbessern?',
      'Was motiviert dich an diesem Thema?',
    ],
    Essen: [
      'Was macht das für dich besonders lecker?',
      'Würdest du etwas daran ändern?',
      'Wie oft isst du so etwas normalerweise?',
    ],
    Hobbys: [
      'Was gefällt dir daran am meisten?',
      'Seit wann machst du das schon?',
      'Was würdest du gern als Nächstes lernen?',
    ],
    Technik: [
      'Welche Funktion nutzt du am meisten?',
      'Was müsste daran noch besser sein?',
      'Wie hilft dir das im Alltag?',
    ],
    Alltag: [
      'Wann merkst du das am stärksten?',
      'Was würdest du daran gern ändern?',
      'Welche kleine Gewohnheit hilft dir dabei?',
    ],
  };

  const options = topicFollowUps[topicLabel] || topicFollowUps.Alltag;
  const followUp = options[turnCount % options.length];

  return `${keywordText} ${followUp}`.trim();
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function textResponse(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(text);
}

async function readRequestBody(req) {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty model response.');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model response was not valid JSON.');
  }
}

function normalizePartOfSpeech(value) {
  const normalized = normalizeText(value).toLowerCase();

  if (['verb', 'verben'].includes(normalized)) {
    return 'verb';
  }

  if (['noun', 'nomen', 'substantiv'].includes(normalized)) {
    return 'noun';
  }

  if (['adjective', 'adjektiv'].includes(normalized)) {
    return 'adjective';
  }

  if (['other', 'sonstiges'].includes(normalized)) {
    return 'other';
  }

  return 'unknown';
}

function normalizeGenderEndings(value) {
  return {
    maskulin: normalizeText(value?.maskulin || ''),
    feminin: normalizeText(value?.feminin || ''),
    neutrum: normalizeText(value?.neutrum || ''),
    plural: normalizeText(value?.plural || ''),
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of value) {
    const text = normalizeText(item);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }

  return result.slice(0, 8);
}

function normalizeWordForms(word, parsed) {
  const safeWord = normalizeText(word);
  const partOfSpeech = normalizePartOfSpeech(parsed?.partOfSpeech || 'unknown');

  const base = {
    word: safeWord,
    partOfSpeech,
    translation: normalizeText(parsed?.translation || ''),
    notes: normalizeText(parsed?.notes || ''),

    // Noun-specific
    article: normalizeText(parsed?.article || ''),
    plural: normalizeText(parsed?.plural || ''),
    relatedVerbs: normalizeStringList(parsed?.relatedVerbs),
    cases: {
      nominativ: normalizeText(parsed?.cases?.nominativ || ''),
      akkusativ: normalizeText(parsed?.cases?.akkusativ || ''),
      dativ: normalizeText(parsed?.cases?.dativ || ''),
      genitiv: normalizeText(parsed?.cases?.genitiv || ''),
    },

    // Verb-specific
    infinitive: normalizeText(parsed?.infinitive || safeWord),
    auxiliary: normalizeText(parsed?.auxiliary || ''),
    governs: normalizeText(parsed?.governs || ''),
    present: normalizeText(parsed?.present || ''),
    past: normalizeText(parsed?.past || ''),
    future: normalizeText(parsed?.future || ''),
    perfect: normalizeText(parsed?.perfect || ''),
    imperative: normalizeText(parsed?.imperative || ''),
    conjugation: {
      ich: normalizeText(parsed?.conjugation?.ich || ''),
      du: normalizeText(parsed?.conjugation?.du || ''),
      erSieEs: normalizeText(parsed?.conjugation?.erSieEs || ''),
      wir: normalizeText(parsed?.conjugation?.wir || ''),
      ihr: normalizeText(parsed?.conjugation?.ihr || ''),
      sie: normalizeText(parsed?.conjugation?.sie || ''),
    },

    // Adjective-specific
    comparative: normalizeText(parsed?.comparative || ''),
    superlative: normalizeText(parsed?.superlative || ''),
    commonVerbs: normalizeStringList(parsed?.commonVerbs),
    declension: {
      nominativ: normalizeGenderEndings(parsed?.declension?.nominativ),
      akkusativ: normalizeGenderEndings(parsed?.declension?.akkusativ),
      dativ: normalizeGenderEndings(parsed?.declension?.dativ),
      genitiv: normalizeGenderEndings(parsed?.declension?.genitiv),
    },
  };

  if (base.partOfSpeech !== 'noun') {
    base.article = '';
    base.plural = '';
    base.relatedVerbs = [];
    base.cases = { nominativ: '', akkusativ: '', dativ: '', genitiv: '' };
  }

  if (base.partOfSpeech !== 'verb') {
    base.auxiliary = '';
    base.governs = '';
    base.present = '';
    base.past = '';
    base.future = '';
    base.perfect = '';
    base.imperative = '';
    base.conjugation = {
      ich: '',
      du: '',
      erSieEs: '',
      wir: '',
      ihr: '',
      sie: '',
    };
  }

  if (base.partOfSpeech !== 'adjective') {
    base.comparative = '';
    base.superlative = '';
    base.commonVerbs = [];
    const emptyEndings = { maskulin: '', feminin: '', neutrum: '', plural: '' };
    base.declension = {
      nominativ: emptyEndings,
      akkusativ: emptyEndings,
      dativ: emptyEndings,
      genitiv: emptyEndings,
    };
  }

  return base;
}

async function extractVocabularyCandidates(sentence) {
  const safeSentence = normalizeText(sentence);

  if (!safeSentence) {
    return [];
  }

  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
      },
      messages: [
        {
          role: 'system',
          content:
            'Du bist ein präziser deutscher NLP-Assistent. Gib ausschließlich valides JSON im Format {"items":[{"word":"...","partOfSpeech":"verb|noun|adjective","lemma":"..."}]}. Extrahiere aus dem Satz nur deutsche Verben, Nomen und Adjektive. Keine anderen Wortarten. Keine Duplikate.',
        },
        {
          role: 'user',
          content: `Satz: ${safeSentence}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama vocabulary extraction failed with status ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.message?.content ?? '';
  const parsed = extractJson(content);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

  const seen = new Set();
  const filtered = [];

  for (const item of rawItems) {
    const word = normalizeText(item?.word || '');
    const partOfSpeech = normalizePartOfSpeech(item?.partOfSpeech || '');
    const lemma = normalizeText(item?.lemma || word);

    if (!word || !['verb', 'noun', 'adjective'].includes(partOfSpeech)) {
      continue;
    }

    const dedupeKey = `${word.toLowerCase()}::${partOfSpeech}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    filtered.push({ word, partOfSpeech, lemma });
  }

  return filtered;
}

async function getWordForms(word) {
  const safeWord = normalizeText(word);
  if (!safeWord) {
    throw new Error('Missing word for forms lookup.');
  }

  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
      },
      messages: [
        {
          role: 'system',
          content: [
            'Du bist ein präziser deutscher Grammatik-Lexikon-Assistent, vergleichbar mit Duden Online.',
            'Gib ausschließlich valides JSON zurück, exakt in dieser Struktur (fülle nur die zur Wortart passenden Felder, der Rest bleibt leerer String "" bzw. leere Liste []):',
            '{',
            '  "partOfSpeech": "verb|noun|adjective|other",',
            '  "translation": "kurze, präzise englische Übersetzung des Wortes",',
            '  "notes": "optionale kurze Zusatzhinweise, z.B. Register, Besonderheiten",',
            '',
            '  "article": "der|die|das (nur bei Nomen)",',
            '  "plural": "Pluralform (nur bei Nomen)",',
            '  "relatedVerbs": ["Verben, die häufig zusammen mit diesem Nomen verwendet werden, z.B. machen, nehmen, geben"],',
            '  "cases": {"nominativ":"der Tisch","akkusativ":"den Tisch","dativ":"dem Tisch","genitiv":"des Tisches"},',
            '',
            '  "infinitive": "Infinitivform (nur bei Verben)",',
            '  "auxiliary": "haben|sein (Hilfsverb für Perfekt, nur bei Verben)",',
            '  "governs": "welchen Kasus das Verb regiert, z.B. Akkusativ, Dativ, Akkusativ+Dativ, oder leer",',
            '  "present": "Präsens 3. Person Singular",',
            '  "past": "Präteritum 3. Person Singular",',
            '  "future": "Futur I 3. Person Singular",',
            '  "perfect": "Perfekt 3. Person Singular, z.B. hat gegessen",',
            '  "imperative": "Imperativ Singular (du-Form)",',
            '  "conjugation": {"ich":"...","du":"...","erSieEs":"...","wir":"...","ihr":"...","sie":"..."} (Präsens, nur bei Verben),',
            '',
            '  "comparative": "Komparativform (nur bei Adjektiven)",',
            '  "superlative": "Superlativform mit am, z.B. am schönsten (nur bei Adjektiven)",',
            '  "commonVerbs": ["Verben, die häufig mit diesem Adjektiv verwendet werden, z.B. sein, werden, finden, aussehen"],',
            '  "declension": {',
            '    "nominativ": {"maskulin":"-e","feminin":"-e","neutrum":"-e","plural":"-en"},',
            '    "akkusativ": {"maskulin":"-en","feminin":"-e","neutrum":"-e","plural":"-en"},',
            '    "dativ": {"maskulin":"-en","feminin":"-en","neutrum":"-en","plural":"-en"},',
            '    "genitiv": {"maskulin":"-en","feminin":"-en","neutrum":"-en","plural":"-en"}',
            '  } (Adjektivendungen nach bestimmtem Artikel, nur bei Adjektiven)',
            '}',
            'Sei linguistisch korrekt und prägnant. Keine Erklärtexte außerhalb des JSON.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Gib alle grammatischen Informationen für dieses deutsche Wort: ${safeWord}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama word-form request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.message?.content ?? '';
  const parsed = extractJson(content);
  return normalizeWordForms(safeWord, parsed);
}

function fallbackReply(input) {
  const topicLabel = TOPIC_LABELS[input.topicIndex] || 'Alltag';
  const latestUserMessage = getLatestUserMessage(input.messages);
  const keywords = extractKeywords(latestUserMessage);
  const echo = latestUserMessage ? `Du hast gesagt: „${latestUserMessage}“.` : 'Danke für deine Antwort.';
  const followUp = buildFollowUp(topicLabel, keywords, Number(input.turnCount || 0));

  return {
    reply: `${echo} ${followUp || 'Erzähl mir bitte noch etwas mehr.'}`,
    difficulty: clamp(Number(input.difficulty || 2), 1, 5),
    topicIndex: clamp(Number(input.topicIndex || 0), 0, TOPIC_LABELS.length - 1),
  };
}

function buildPrompt(input) {
  const topic = input.topic || {};
  const topicLabel = topic.label || TOPIC_LABELS[input.topicIndex] || 'Alltag';
  const topicOpeners = Array.isArray(topic.followUps) ? topic.followUps : [];
  const latestUserMessage = getLatestUserMessage(input.messages);

  return [
    'Du bist Deutsch Lehrer AI, ein freundlicher und entspannter deutscher Gesprächspartner für Sprachübung.',
    'Antworte nur auf Deutsch, in 1 bis 3 natürlichen Sätzen.',
    'WICHTIGSTE REGEL: Lies die gesamte bisherige Konversation (alle vorherigen Nachrichten) und beantworte zuerst wirklich das, was der Nutzer zuletzt gesagt oder gefragt hat. Gehe konkret auf den Inhalt ein, nicht nur allgemein.',
    'Wenn der Nutzer sich auf etwas bezieht, das er oder du vorher gesagt habt (z.B. "wie ich schon sagte" oder "du hast gefragt..."), nutze den Gesprächsverlauf, um das korrekt zu erkennen und darauf einzugehen.',
    'Sei nicht dogmatisch oder übermäßig belehrend: Du musst nicht bei jeder Antwort eine Korrektur einbauen. Korrigiere Fehler höchstens sehr subtil und nur gelegentlich, indem du die richtige Form natürlich in deiner eigenen Antwort verwendest. Bestehe nicht darauf, dass eine Formulierung "falsch" ist, wenn der Kontext unklar ist — frage im Zweifel freundlich nach, statt zu korrigieren.',
    'Schreibe keine separate Grammatikanalyse oder Fehlerliste mitten im Gespräch.',
    'Stelle am Ende höchstens eine natürliche Rückfrage, die zum Gesagten passt, aber nur wenn es zum Gesprächsfluss passt.',
    'Bewerte bei JEDER Antwort das tatsächlich gezeigte Sprachniveau der LETZTEN Nutzerantwort neu und unabhängig von der vorherigen Einstufung: 1=A1 (sehr einfach), 2=A2 (einfach), 3=B1 (Mittelstufe), 4=B2 (gehoben), 5=C1 (fortgeschritten). Achte auf Satzlänge, Nebensätze, Wortschatz und Grammatikgenauigkeit.',
    'Wenn die Antwort deutlich komplexer oder einfacher ist als die bisherige Einstufung, passe den difficulty-Wert entsprechend an — auch größere Sprünge sind erlaubt, wenn klar gerechtfertigt. Rate nicht konservativ; gib den Wert zurück, der am besten zur tatsächlichen Antwort passt.',
    'Antworte ausschließlich mit JSON im Format {"reply":"...","difficulty":1-5,"topicIndex":0-5}.',
    `Aktuelles Thema: ${topicLabel}`,
    `Bisherige Einstufung (nur zur Orientierung, nicht bindend): ${input.difficulty}`,
    `Turn count: ${input.turnCount}`,
    `Themenhinweise: ${topicOpeners.join(' | ')}`,
    `Letzte Nutzerantwort: ${latestUserMessage || '—'}`,
  ].join('\n');
}

function mapChatMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message.text === 'string' && message.text.trim().length > 0)
    .slice(-30)
    .map((message) => ({
      role: message.role === 'coach' ? 'assistant' : 'user',
      content: message.text,
    }));
}

async function getOllamaReply(input) {
  const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.7,
      },
      messages: [
        { role: 'system', content: buildPrompt(input) },
        ...mapChatMessages(input.messages),
        {
          role: 'user',
          content: 'Bitte antworte jetzt auf meine letzte Nachricht im Kontext des bisherigen Gesprächs. Gib nur JSON zurück.',
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.message?.content ?? '';
  const parsed = extractJson(content);

  return {
    reply: String(parsed.reply || 'Erzähl mir bitte noch etwas mehr auf Deutsch.'),
    difficulty: clamp(Number(parsed.difficulty || input.difficulty || 2), 1, 5),
    topicIndex: clamp(Number(parsed.topicIndex || input.topicIndex || 0), 0, TOPIC_LABELS.length - 1),
  };
}

async function getAgentReply(input) {
  try {
    return await getOllamaReply(input);
  } catch (error) {
    console.error('Ollama failed:', error.message);
    if (strictOllamaOnly) {
      throw error;
    }
    return fallbackReply(input);
  }
}

async function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = urlPath === '/' ? path.join(distDir, 'index.html') : path.join(distDir, urlPath.replace(/^\//, ''));

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      const index = await readFile(path.join(distDir, 'index.html'));
      return textResponse(res, 200, index.toString('utf-8'), 'text/html; charset=utf-8');
    }

    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
          ? 'text/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';
    textResponse(res, 200, content.toString('utf-8'), contentType);
  } catch {
    const index = await readFile(path.join(distDir, 'index.html')).catch(() => null);
    if (index) {
      textResponse(res, 200, index.toString('utf-8'), 'text/html; charset=utf-8');
    } else {
      textResponse(res, 404, 'Not found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    return textResponse(res, 400, 'Invalid request');
  }

  if (req.method === 'OPTIONS') {
    return textResponse(res, 204, '');
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return jsonResponse(res, 200, {
      ok: true,
      provider: 'ollama',
      model: ollamaModel,
      strict: strictOllamaOnly,
    });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const input = JSON.parse(body || '{}');
      const reply = await getAgentReply(input);
      return jsonResponse(res, 200, reply);
    } catch (error) {
      console.error('Chat API error:', error);
      return jsonResponse(res, 500, {
        reply: 'Entschuldige, ich hatte gerade ein Problem. Kannst du die Frage noch einmal stellen?',
        difficulty: 2,
        topicIndex: 0,
      });
    }
  }

  if (url.pathname === '/api/vocabulary/extract' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const input = JSON.parse(body || '{}');
      const sentence = normalizeText(input.sentence || '');
      const items = await extractVocabularyCandidates(sentence);
      return jsonResponse(res, 200, { items });
    } catch (error) {
      console.error('Vocabulary extract API error:', error);
      return jsonResponse(res, 502, {
        error: 'vocabulary_extraction_failed',
        items: [],
      });
    }
  }

  if (url.pathname === '/api/word-forms' && req.method === 'POST') {
    let requestedWord = 'Wetter';
    try {
      const body = await readRequestBody(req);
      const input = JSON.parse(body || '{}');
      requestedWord = normalizeText(input.word || '');
      const forms = await getWordForms(requestedWord);
      return jsonResponse(res, 200, forms);
    } catch (error) {
      console.error('Word forms API error:', error);
      return jsonResponse(res, 502, {
        error: 'word_forms_failed',
        word: requestedWord || '',
      });
    }
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  return textResponse(res, 404, 'Not found');
});

server.listen(port, () => {
  const mode = strictOllamaOnly ? 'strict' : 'with-fallback';
  console.log(`Deutsch Lehrer AI backend running on http://localhost:${port} [ollama=${ollamaModel},mode=${mode}]`);
});
