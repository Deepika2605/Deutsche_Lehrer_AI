import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 8787);

// --- Dual Engine Provider Orchestration Config ---
// Swap engine targets on runtime by specifying AI_PROVIDER=gemini or AI_PROVIDER=ollama
const aiProvider = (process.env.AI_PROVIDER || 'ollama').toLowerCase();

// Ollama config
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';

// Gemini config
const geminiApiKey = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!['gemini', 'ollama'].includes(aiProvider)) {
  throw new Error(
    `Unsupported AI_PROVIDER "${aiProvider}". Use "gemini" or "ollama".`
  );
}

const TOPIC_LABELS = ['Reisen', 'Arbeit', 'Essen', 'Hobbys', 'Technik', 'Alltag'];

async function generateAiContent(promptText, options = {}) {
  const { temperature = 0.7, maxOutputTokens = 800 } = options;

  if (aiProvider === 'gemini') {
    if (!geminiApiKey) {
      throw new Error(
        'Gemini API key is missing. Please set GEMINI_API_KEY in your environment variables.'
      );
    }

    const response = await geminiApiKey.models.generateContent({
      model: geminiModel,
      contents: promptText,
      config: {
        temperature,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    });

    return response.text || '';
  }

  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      format: 'json',
      options: { temperature },
      prompt: promptText,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.response || '';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function getLatestUserMessage(messages) {
  if (!Array.isArray(messages)) return '';

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === 'user' && typeof message.text === 'string') {
      return normalizeText(message.text);
    }
  }

  return '';
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

function textResponse(
  res,
  statusCode,
  text,
  contentType = 'text/plain; charset=utf-8'
) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  res.end(text);
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
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
  const trimmed = String(text || '').trim();

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

  if (['verb', 'verben'].includes(normalized)) return 'verb';
  if (['noun', 'nomen', 'substantiv'].includes(normalized)) return 'noun';
  if (['adjective', 'adjektiv'].includes(normalized)) return 'adjective';
  if (['other', 'sonstiges'].includes(normalized)) return 'other';

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
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const result = [];

  for (const item of value) {
    const text = normalizeText(item);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result.slice(0, 8);
}

function normalizeWordForms(word, parsed) {
  const safeWord = normalizeText(word);
  const partOfSpeech = normalizePartOfSpeech(
    parsed?.partOfSpeech || 'unknown'
  );

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
    base.cases = {
      nominativ: '',
      akkusativ: '',
      dativ: '',
      genitiv: '',
    };
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

    const emptyEndings = {
      maskulin: '',
      feminin: '',
      neutrum: '',
      plural: '',
    };

    base.declension = {
      nominativ: { ...emptyEndings },
      akkusativ: { ...emptyEndings },
      dativ: { ...emptyEndings },
      genitiv: { ...emptyEndings },
    };
  }

  return base;
}

async function extractVocabularyCandidates(sentence) {
  const safeSentence = normalizeText(sentence);
  if (!safeSentence) return [];

  const prompt = [
    'Du bist ein präziser deutscher NLP-Assistent.',
    'Gib ausschließlich valides JSON im Format {"items":[{"word":"...","partOfSpeech":"verb|noun|adjective","lemma":"..."}]}.',
    'Extrahiere aus dem Satz nur deutsche Verben, Nomen und Adjektive. Keine anderen Wortarten. Keine Duplikate.',
    `Satz: ${safeSentence}`,
  ].join('\n');

  const parsed = extractJson(
    await generateAiContent(prompt, {
      temperature: 0.1,
      maxOutputTokens: 500,
    })
  );

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
    if (seen.has(dedupeKey)) continue;

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

  const prompt = [
    'Du bist ein präziser deutscher Grammatik-Lexikon-Assistent, vergleichbar mit Duden Online.',
    'Gib ausschließlich valides JSON zurück. Fülle nur die zur Wortart passenden Felder; der Rest bleibt leerer String "" bzw. leere Liste [].',
    '{',
    '  "partOfSpeech": "verb|noun|adjective|other",',
    '  "translation": "kurze, präzise englische Übersetzung des Wortes",',
    '  "notes": "optionale kurze Zusatzhinweise, z.B. Register, Besonderheiten",',
    '  "article": "der|die|das (nur bei Nomen)",',
    '  "plural": "Pluralform (nur bei Nomen)",',
    '  "relatedVerbs": ["häufige Verben zusammen mit diesem Nomen"],',
    '  "cases": {"nominativ":"der Tisch","akkusativ":"den Tisch","dativ":"dem Tisch","genitiv":"des Tisches"},',
    '  "infinitive": "Infinitivform (nur bei Verben)",',
    '  "auxiliary": "haben|sein (Hilfsverb für Perfekt, nur bei Verben)",',
    '  "governs": "welchen Kasus das Verb regiert",',
    '  "present": "Präsens 3. Person Singular",',
    '  "past": "Präteritum 3. Person Singular",',
    '  "future": "Futur I 3. Person Singular",',
    '  "perfect": "Perfekt 3. Person Singular",',
    '  "imperative": "Imperativ Singular (du-Form)",',
    '  "conjugation": {"ich":"...","du":"...","erSieEs":"...","wir":"...","ihr":"...","sie":"..."},',
    '  "comparative": "Komparativform",',
    '  "superlative": "Superlativform mit am",',
    '  "commonVerbs": ["häufige Verben mit diesem Adjektiv"],',
    '  "declension": {',
    '    "nominativ": {"maskulin":"","feminin":"","neutrum":"","plural":""},',
    '    "akkusativ": {"maskulin":"","feminin":"","neutrum":"","plural":""},',
    '    "dativ": {"maskulin":"","feminin":"","neutrum":"","plural":""},',
    '    "genitiv": {"maskulin":"","feminin":"","neutrum":"","plural":""}',
    '  }',
    '}',
    'Sei linguistisch korrekt und prägnant. Keine Erklärtexte außerhalb des JSON.',
    `Gib alle grammatischen Informationen für dieses deutsche Wort: ${safeWord}`,
  ].join('\n');

  const parsed = extractJson(
    await generateAiContent(prompt, {
      temperature: 0.1,
      maxOutputTokens: 1200,
    })
  );

  return normalizeWordForms(safeWord, parsed);
}

function buildPrompt(input) {
  const topic = input.topic || {};
  const topicLabel = topic.label || TOPIC_LABELS[input.topicIndex] || 'Alltag';
  const topicOpeners = Array.isArray(topic.followUps) ? topic.followUps : [];

  return [
    'Du bist Deutsch Lehrer AI, ein freundlicher und entspannter deutscher Gesprächspartner für Sprachübung.',
    'Antworte nur auf Deutsch, in 1 bis 3 natürlichen Sätzen.',
    'WICHTIGSTE REGEL: Lies die gesamte bisherige Konversation (alle vorherigen Nachrichten) und beantworte zuerst wirklich das, was der Nutzer zuletzt gesagt oder gefragt hat. Gehe konkret auf den Inhalt ein, nicht nur allgemein.',
    'Wenn der Nutzer sich auf etwas bezieht, das du vorher gesagt hast, nutze den Gesprächsverlauf, um das korrekt zu erkennen und darauf einzugehen.',
    'Sei nicht dogmatisch oder übermäßig belehrend: Korrigiere Fehler höchstens sehr subtil und nur gelegentlich, indem du die richtige Form natürlich in deiner eigenen Antwort verwendest.',
    'Schreibe keine separate Grammatikanalyse oder Fehlerliste mitten im Gespräch.',
    'Stelle am Ende höchstens eine natürliche Rückfrage, die zum Gesagten passt, aber nur wenn es zum Gesprächsfluss passt.',
    'Bewerte bei JEDER Antwort das tatsächlich gezeigte Sprachniveau der LETZTEN Nutzerantwort neu: 1=A1, 2=A2, 3=B1, 4=B2, 5=C1. Achte auf Satzlänge, Nebensätze, Wortschatz und Grammatikgenauigkeit.',
    'Wenn die Antwort deutlich komplexer oder einfacher ist als die bisherige Einstufung, passe den difficulty-Wert entsprechend an.',
    'Antworte ausschließlich mit JSON im Format {"reply":"...","difficulty":1-5,"topicIndex":0-5}.',
    `Aktuelles Thema: ${topicLabel}`,
    `Bisherige Einstufung (nur zur Orientierung, nicht bindend): ${input.difficulty}`,
    `Turn count: ${input.turnCount}`,
    `Themenhinweise: ${topicOpeners.join(' | ')}`,
  ].join('\n');
}

function mapChatMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (message) =>
        message &&
        typeof message.text === 'string' &&
        message.text.trim().length > 0
    )
    .slice(-30)
    .map((message) => ({
      role: message.role === 'coach' ? 'assistant' : 'user',
      content: message.text,
    }));
}

async function getAgentReply(input) {
  const history = mapChatMessages(input.messages)
    .map(
      (message) =>
        `${message.role === 'assistant' ? 'Assistent' : 'Nutzer'}: ${message.content}`
    )
    .join('\n');

  const prompt = [
    buildPrompt(input),
    '',
    'Bisheriger Gesprächsverlauf:',
    history || '(Noch kein Gesprächsverlauf vorhanden.)',
    '',
    'Bitte antworte jetzt auf die letzte Nachricht im Kontext des bisherigen Gesprächs. Gib nur JSON zurück.',
  ].join('\n');

  try {
    const parsed = extractJson(
      await generateAiContent(prompt, {
        temperature: 0.7,
        maxOutputTokens: 500,
      })
    );

    return {
      reply: String(
        parsed.reply || 'Erzähl mir bitte noch etwas mehr auf Deutsch.'
      ),
      difficulty: clamp(
        Number(parsed.difficulty ?? input.difficulty ?? 2),
        1,
        5
      ),
      topicIndex: clamp(
        Number(parsed.topicIndex ?? input.topicIndex ?? 0),
        0,
        TOPIC_LABELS.length - 1
      ),
    };
  } catch (error) {
    console.error(`${aiProvider} chat failed:`, error.message);
    throw error;
  }
}

async function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = path.resolve(
    distDir,
    urlPath === '/' ? 'index.html' : `.${urlPath}`
  );

  // Prevent requests from accessing files outside the dist directory.
  if (
    filePath !== distDir &&
    !filePath.startsWith(`${distDir}${path.sep}`)
  ) {
    return textResponse(res, 403, 'Forbidden');
  }

  try {
    const fileStat = await stat(filePath);

    if (fileStat.isDirectory()) {
      const index = await readFile(path.join(distDir, 'index.html'));
      return textResponse(
        res,
        200,
        index.toString('utf-8'),
        'text/html; charset=utf-8'
      );
    }

    const content = await readFile(filePath);
    const ext = path.extname(filePath);

    const contentType =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ['.js', '.mjs'].includes(ext)
          ? 'text/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';

    return textResponse(
      res,
      200,
      content.toString('utf-8'),
      contentType
    );
  } catch {
    const index = await readFile(
      path.join(distDir, 'index.html')
    ).catch(() => null);

    if (index) {
      return textResponse(
        res,
        200,
        index.toString('utf-8'),
        'text/html; charset=utf-8'
      );
    }

    return textResponse(res, 404, 'Not found');
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

  // Health endpoint reports the currently selected AI provider.
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return jsonResponse(res, 200, {
      ok: true,
      provider: aiProvider,
      model: aiProvider === 'gemini' ? geminiModel : ollamaModel,
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
        reply:
          'Entschuldige, ich hatte gerade ein Problem. Kannst du die Frage noch einmal stellen?',
        difficulty: 2,
        topicIndex: 0,
      });
    }
  }

  if (
    url.pathname === '/api/vocabulary/extract' &&
    req.method === 'POST'
  ) {
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
    let requestedWord = '';

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
        word: requestedWord,
      });
    }
  }

  if (req.method === 'GET') {
    return serveStatic(req, res);
  }

  return textResponse(res, 404, 'Not found');
});

server.listen(port, () => {
  const model = aiProvider === 'gemini' ? geminiModel : ollamaModel;

  console.log(
    `Deutsch Lehrer AI backend running on http://localhost:${port} [provider=${aiProvider},model=${model}]`
  );
});