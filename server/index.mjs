import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 8787);
const isVercel = Boolean(process.env.VERCEL);
const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;

const SUPPORTED_PROVIDERS = ['gemini', 'ollama', 'openrouter'];
const TOPIC_LABELS = ['Reisen', 'Arbeit', 'Essen', 'Hobbys', 'Technik', 'Alltag'];

const aiProvider = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const openrouterModel =
  process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let openrouterClient = null;
let geminiClient = null;

function log(level, event, details = {}) {
  const payload = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...details,
  });

  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.log(payload);
}

function getActiveModel() {
  if (aiProvider === 'gemini') return geminiModel;
  if (aiProvider === 'openrouter') return openrouterModel;
  return ollamaModel;
}

function getOpenRouterClient() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OpenRouter API key is missing. Please set OPENROUTER_API_KEY in your environment variables.'
    );
  }

  if (!openrouterClient) {
    openrouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }

  return openrouterClient;
}

function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'Gemini API key is missing. Please set GEMINI_API_KEY in your environment variables.'
    );
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  return geminiClient;
}

function assertSupportedProvider() {
  if (!SUPPORTED_PROVIDERS.includes(aiProvider)) {
    throw new Error(
      `Unsupported AI_PROVIDER "${aiProvider}". Use "gemini", "ollama", or "openrouter".`
    );
  }
}

async function generateAiContent(promptText, options = {}) {
  const { temperature = 0.7, maxOutputTokens = 800 } = options;

  if (aiProvider === 'openrouter') {
    const response = await getOpenRouterClient().chat.completions.create({
      model: openrouterModel,
      messages: [{ role: 'user', content: promptText }],
      temperature,
      response_format: { type: 'json_object' },
      max_tokens: maxOutputTokens,
    });

    return response.choices[0]?.message?.content || '';
  }

  if (aiProvider === 'gemini') {
    const response = await getGeminiClient().models.generateContent({
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
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) {
      return req.body.toString('utf8');
    }

    if (typeof req.body === 'string') {
      return req.body;
    }

    return JSON.stringify(req.body);
  }

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

async function readJsonBody(req) {
  const raw = await readRequestBody(req);

  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    return raw;
  }

  return JSON.parse(raw || '{}');
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

  const started = Date.now();
  const parsed = extractJson(
    await generateAiContent(prompt, {
      temperature: 0.7,
      maxOutputTokens: 500,
    })
  );

  log('info', 'chat_model_ok', {
    provider: aiProvider,
    model: getActiveModel(),
    ms: Date.now() - started,
    historyTurns: mapChatMessages(input.messages).length,
  });

  return {
    reply: String(
      parsed.reply || 'Erzähl mir bitte noch etwas mehr auf Deutsch.'
    ),
    difficulty: clamp(Number(parsed.difficulty ?? input.difficulty ?? 2), 1, 5),
    topicIndex: clamp(
      Number(parsed.topicIndex ?? input.topicIndex ?? 0),
      0,
      TOPIC_LABELS.length - 1
    ),
  };
}

async function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const filePath = path.resolve(
    distDir,
    urlPath === '/' ? 'index.html' : `.${urlPath}`
  );

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) {
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

    return textResponse(res, 200, content.toString('utf-8'), contentType);
  } catch {
    const index = await readFile(path.join(distDir, 'index.html')).catch(
      () => null
    );

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

function createApiHandler(routePath, allowedMethods, impl) {
  return async function routeHandler(req, res) {
    const started = Date.now();
    const method = req.method || 'GET';

    log('info', 'request_start', {
      method,
      path: routePath,
      provider: aiProvider,
    });

    try {
      if (method === 'OPTIONS') {
        return textResponse(res, 204, '');
      }

      if (!allowedMethods.includes(method)) {
        return jsonResponse(res, 405, { error: `Method ${method} not allowed` });
      }

      assertSupportedProvider();
      return await impl(req, res);
    } catch (error) {
      log('error', 'request_failed', {
        method,
        path: routePath,
        provider: aiProvider,
        model: getActiveModel(),
        message: error.message,
      });

      if (routePath === '/api/chat') {
        return jsonResponse(res, 500, {
          reply:
            'Entschuldige, ich hatte gerade ein Problem. Kannst du die Frage noch einmal stellen?',
          difficulty: 2,
          topicIndex: 0,
        });
      }

      return jsonResponse(res, 500, { error: error.message || 'Server error' });
    } finally {
      log('info', 'request_end', {
        method,
        path: routePath,
        status: res.statusCode || 0,
        ms: Date.now() - started,
        provider: aiProvider,
      });
    }
  };
}

export const handleHealth = createApiHandler(
  '/api/health',
  ['GET'],
  async (_req, res) =>
    jsonResponse(res, 200, {
      ok: true,
      provider: aiProvider,
      model: getActiveModel(),
    })
);

export const handleChat = createApiHandler(
  '/api/chat',
  ['POST'],
  async (req, res) => {
    const input = await readJsonBody(req);
    const reply = await getAgentReply(input);
    return jsonResponse(res, 200, reply);
  }
);

// Vocabulary is deferred. Add api/vocabulary/extract.mjs and api/word-forms.mjs
// later, then wire them here the same way as handleHealth / handleChat.
//
// export const handleVocabularyExtract = createApiHandler(
//   '/api/vocabulary/extract',
//   ['POST'],
//   async (req, res) => {
//     const input = await readJsonBody(req);
//     const items = await extractVocabulary(input.sentence);
//     return jsonResponse(res, 200, { items });
//   }
// );
//
// export const handleWordForms = createApiHandler(
//   '/api/word-forms',
//   ['POST'],
//   async (req, res) => {
//     const input = await readJsonBody(req);
//     const forms = await getWordForms(input.word);
//     return jsonResponse(res, 200, forms);
//   }
// );

export default async function handler(req, res) {
  if (!req.url) {
    return textResponse(res, 400, 'Invalid request');
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health') {
    return handleHealth(req, res);
  }

  if (url.pathname === '/api/chat') {
    return handleChat(req, res);
  }

  if (!isVercel && (req.method || 'GET') === 'GET') {
    return serveStatic(req, res);
  }

  return textResponse(res, 404, 'Not found');
}

if (isDirectRun && !isVercel) {
  assertSupportedProvider();

  http.createServer(handler).listen(port, () => {
    log('info', 'local_listen', {
      port,
      provider: aiProvider,
      model: getActiveModel(),
    });
  });
}
