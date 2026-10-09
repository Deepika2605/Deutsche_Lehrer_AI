export type Topic = {
  id: string;
  label: string;
  opening: string;
  followUps: string[];
  nouns: string[];
  verbs: string[];
  adjectives: string[];
};

export type FeedbackItem = {
  before: string;
  after: string;
  reason: string;
};

export type TurnReview = {
  topicId: string;
  message: string;
  wordCount: number;
  difficultyBefore: number;
  difficultyAfter: number;
  strengths: string[];
  corrections: FeedbackItem[];
  recommendedWords: string[];
};

export type PracticeSession = {
  id: string;
  startedAt: number;
  endedAt: number;
  topicId: string;
  turns: TurnReview[];
  finalDifficulty: number;
};

export type SessionSummary = {
  sessionLabel: string;
  topicLabel: string;
  totalTurns: number;
  averageWords: number;
  finalDifficulty: number;
  corrections: FeedbackItem[];
  recommendedWords: string[];
  strengths: string[];
  nextGoal: string;
};

export type ConversationMessage = {
  role: 'coach' | 'user';
  text: string;
};

export type TutorReply = {
  reply: string;
  difficulty: number;
  topicIndex: number;
};

export type VocabularyCandidate = {
  word: string;
  partOfSpeech: 'verb' | 'noun' | 'adjective';
  lemma: string;
};

export type GenderEndings = {
  maskulin: string;
  feminin: string;
  neutrum: string;
  plural: string;
};

export type WordForms = {
  word: string;
  partOfSpeech: 'verb' | 'noun' | 'adjective' | 'other' | 'unknown';
  translation: string;
  notes: string;

  // Noun-specific
  article: string;
  plural: string;
  relatedVerbs: string[];
  cases: {
    nominativ: string;
    akkusativ: string;
    dativ: string;
    genitiv: string;
  };

  // Verb-specific
  infinitive: string;
  auxiliary: string;
  governs: string;
  present: string;
  past: string;
  future: string;
  perfect: string;
  imperative: string;
  conjugation: {
    ich: string;
    du: string;
    erSieEs: string;
    wir: string;
    ihr: string;
    sie: string;
  };

  // Adjective-specific
  comparative: string;
  superlative: string;
  commonVerbs: string[];
  declension: {
    nominativ: GenderEndings;
    akkusativ: GenderEndings;
    dativ: GenderEndings;
    genitiv: GenderEndings;
  };
};

export const TOPICS: Topic[] = [
  {
    id: 'travel',
    label: 'Reisen',
    opening: 'Wir sprechen über Reisen. Wo warst du zuletzt, und was hat dir dort gefallen?',
    followUps: [
      'Was würdest du in dieser Stadt unbedingt noch sehen wollen?',
      'Welche Reise war für dich bisher die überraschendste?',
      'Womit planst du deine nächste Reise?',
    ],
    nouns: ['Reise', 'Flughafen', 'Hotel', 'Abenteuer'],
    verbs: ['fahren', 'entdecken', 'planen', 'besuchen'],
    adjectives: ['spannend', 'entspannt', 'interessant', 'praktisch'],
  },
  {
    id: 'work',
    label: 'Arbeit',
    opening: 'Lass uns über Arbeit sprechen. Was macht einen guten Arbeitstag für dich aus?',
    followUps: [
      'Welche Aufgabe motiviert dich am meisten?',
      'Wie würdest du deinen idealen Arbeitsplatz beschreiben?',
      'Was hilft dir, produktiv zu bleiben?',
    ],
    nouns: ['Projekt', 'Team', 'Aufgabe', 'Ziel'],
    verbs: ['organisieren', 'planen', 'erklären', 'verbessern'],
    adjectives: ['effizient', 'klar', 'ruhig', 'anspruchsvoll'],
  },
  {
    id: 'food',
    label: 'Essen',
    opening: 'Jetzt sprechen wir über Essen. Was kochst oder bestellst du am liebsten?',
    followUps: [
      'Welche Zutaten passen für dich immer zusammen?',
      'Was ist ein Gericht, das du gern mit Freunden teilst?',
      'Wie sieht dein perfektes Frühstück aus?',
    ],
    nouns: ['Gericht', 'Zutat', 'Geschmack', 'Rezept'],
    verbs: ['kochen', 'probieren', 'würzen', 'genießen'],
    adjectives: ['lecker', 'frisch', 'knusprig', 'würzig'],
  },
  {
    id: 'hobbies',
    label: 'Hobbys',
    opening: 'Lass uns über Hobbys sprechen. Was machst du gern in deiner Freizeit?',
    followUps: [
      'Was hat dich an diesem Hobby zuerst fasziniert?',
      'Wie oft übst du das pro Woche?',
      'Was würdest du gern als Nächstes lernen?',
    ],
    nouns: ['Freizeit', 'Musik', 'Sport', 'Buch'],
    verbs: ['spielen', 'lernen', 'entspannen', 'ausprobieren'],
    adjectives: ['kreativ', 'ruhig', 'aktiv', 'unterhaltsam'],
  },
  {
    id: 'tech',
    label: 'Technik',
    opening: 'Wir wechseln zu Technik. Welche App oder welches Gerät nutzt du täglich?',
    followUps: [
      'Welche Funktion ist für dich am hilfreichsten?',
      'Was sollte Technik einfacher machen?',
      'Wie verändert Technik deinen Alltag?',
    ],
    nouns: ['App', 'Gerät', 'Bildschirm', 'System'],
    verbs: ['verwenden', 'verbinden', 'speichern', 'entwickeln'],
    adjectives: ['modern', 'schnell', 'zuverlässig', 'intelligent'],
  },
  {
    id: 'daily-life',
    label: 'Alltag',
    opening: 'Zum Schluss etwas Alltägliches. Wie sieht ein typischer Tag bei dir aus?',
    followUps: [
      'Welche kleine Gewohnheit macht deinen Tag besser?',
      'Was würdest du gern an deinem Alltag ändern?',
      'Wann fühlst du dich im Alltag am entspanntesten?',
    ],
    nouns: ['Morgen', 'Routine', 'Termin', 'Pause'],
    verbs: ['aufstehen', 'arbeiten', 'spazieren', 'ausruhen'],
    adjectives: ['ruhig', 'geordnet', 'stressig', 'angenehm'],
  },
];

const ENGLISH_TO_GERMAN: Record<string, { after: string; reason: string }> = {
  and: { after: 'und', reason: 'Verbinde zwei Gedanken mit dem deutschen Konnektor.' },
  but: { after: 'aber', reason: 'Nutze das deutsche Gegenwort.' },
  because: { after: 'weil', reason: 'Begründe deine Aussage direkt auf Deutsch.' },
  very: { after: 'sehr', reason: 'Ein natürlicheres deutsches Intensivierungswort.' },
  good: { after: 'gut', reason: 'Das deutsche Adjektiv passt hier besser.' },
  want: { after: 'möchte', reason: 'Für höflichere und natürlichere Sätze.' },
  thing: { after: 'Sache', reason: 'Das klingt im Deutschen natürlicher.' },
  people: { after: 'Leute', reason: 'Alltagsnahes deutsches Wort.' },
  now: { after: 'jetzt', reason: 'Zeitangabe auf Deutsch.' },
  then: { after: 'dann', reason: 'Gängige deutsche Verbindung.' },
  nice: { after: 'schön', reason: 'Häufigere deutsche Wahl im Gespräch.' },
  big: { after: 'groß', reason: 'Passenderes deutsches Adjektiv.' },
  small: { after: 'klein', reason: 'Passenderes deutsches Adjektiv.' },
};

const CONNECTORS = ['weil', 'obwohl', 'daher', 'trotzdem', 'deshalb', 'während', 'sobald'];
const POSITIVE_WORDS = ['genau', 'interessant', 'klar', 'spannend', 'hilfreich', 'ehrlich'];
const EXTRA_RECOMMENDATIONS = {
  phrases: ['Meiner Meinung nach', 'Ich würde sagen', 'Ein wichtiger Punkt ist', 'Außerdem'],
  verbs: ['erzählen', 'beschreiben', 'begründen', 'vergleichen'],
  adjectives: ['interessant', 'hilfreich', 'angenehm', 'anspruchsvoll'],
};

export function getTopicByIndex(index: number): Topic {
  return TOPICS[((index % TOPICS.length) + TOPICS.length) % TOPICS.length];
}

export function createOpeningPrompt(topic: Topic, difficulty: number): string {
  const base = topic.opening;
  const levelHint =
    difficulty <= 2
      ? 'Antworte gern mit 1–2 einfachen Sätzen.'
      : difficulty === 3
        ? 'Nutze gern ein Beispiel oder eine kurze Begründung.'
        : 'Versuche, einen Nebensatz oder eine kleine Abwägung einzubauen.';

  return `${base} ${levelHint}`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\säöüß]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function analyzeResponse(text: string, topic: Topic, difficultyBefore: number): TurnReview {
  const words = tokenize(text);
  const lowerText = text.toLowerCase();
  const corrections: FeedbackItem[] = [];
  const recommendedWords: string[] = [];
  const strengths: string[] = [];

  for (const [needle, correction] of Object.entries(ENGLISH_TO_GERMAN)) {
    if (lowerText.includes(needle)) {
      corrections.push({
        before: needle,
        after: correction.after,
        reason: correction.reason,
      });
      recommendedWords.push(correction.after);
    }
  }

  if (words.length < 6) {
    corrections.push({
      before: text.trim() || 'deine Antwort',
      after: 'eine etwas längere Antwort mit einem Beispiel',
      reason: 'Ein paar zusätzliche Wörter helfen beim freien Sprechen.',
    });
  }

  if (words.some((word) => CONNECTORS.includes(word))) {
    strengths.push('Du hast verbindende Wörter verwendet.');
  }

  if (words.some((word) => POSITIVE_WORDS.includes(word))) {
    strengths.push('Dein Wortschatz wirkt schon lebendig.');
  }

  if (text.includes('?')) {
    strengths.push('Du hast mit einer Frage oder Neugier reagiert.');
  }

  const topicWords = [...topic.nouns, ...topic.verbs, ...topic.adjectives].map((item) => item.toLowerCase());
  if (topicWords.some((word) => lowerText.includes(word))) {
    strengths.push('Du hast themenspezifische Wörter eingebaut.');
  }

  const varietyBoost = words.length >= 18 ? 1 : 0;
  const connectorBoost = strengths.length > 0 ? 1 : 0;
  const shortResponsePenalty = words.length < 8 ? 1 : 0;
  const correctionPenalty = corrections.length >= 2 ? 1 : 0;
  const nextDifficulty = clamp(difficultyBefore + varietyBoost + connectorBoost - shortResponsePenalty - correctionPenalty, 1, 5);

  if (recommendedWords.length === 0) {
    recommendedWords.push(...topic.verbs.slice(0, 2), ...topic.adjectives.slice(0, 2));
  }

  return {
    topicId: topic.id,
    message: text,
    wordCount: words.length,
    difficultyBefore,
    difficultyAfter: nextDifficulty,
    strengths: uniqueStrings(strengths),
    corrections,
    recommendedWords: uniqueStrings(recommendedWords),
  };
}

function suggestWordsForSummary(session: PracticeSession): string[] {
  const words = session.turns.flatMap((turn) => turn.recommendedWords);
  if (words.length > 0) {
    return uniqueStrings(words).slice(0, 6);
  }

  return uniqueStrings([...EXTRA_RECOMMENDATIONS.verbs, ...EXTRA_RECOMMENDATIONS.adjectives, ...EXTRA_RECOMMENDATIONS.phrases]).slice(0, 6);
}

function collectCorrections(session: PracticeSession): FeedbackItem[] {
  return session.turns.flatMap((turn) => turn.corrections).slice(0, 8);
}

function collectStrengths(session: PracticeSession): string[] {
  return uniqueStrings(session.turns.flatMap((turn) => turn.strengths)).slice(0, 5);
}

export function buildSessionSummary(session: PracticeSession, topic: Topic): SessionSummary {
  const totalWords = session.turns.reduce((sum, turn) => sum + turn.wordCount, 0);
  const averageWords = session.turns.length > 0 ? totalWords / session.turns.length : 0;

  return {
    sessionLabel: new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    topicLabel: topic.label,
    totalTurns: session.turns.length,
    averageWords,
    finalDifficulty: session.finalDifficulty,
    corrections: collectCorrections(session),
    recommendedWords: suggestWordsForSummary(session),
    strengths: collectStrengths(session),
    nextGoal:
      session.finalDifficulty >= 4
        ? 'Nächstes Mal mehr Nebensätze, zum Beispiel mit weil, obwohl oder während.'
        : 'Nächstes Mal längere Antworten mit einem konkreten Beispiel üben.',
  };
}

export type VocabularyEntry = {
  word: string;
  context: string;
  addedAt: number;
  frequency: number;
  partOfSpeech?: 'verb' | 'noun' | 'adjective';
  lemma?: string;
  forms?: WordForms;
};

export type VocabularyBank = {
  entries: VocabularyEntry[];
  lastUpdated: number;
};

export function createSessionId(): string {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

export function addVocabularyCandidatesToBank(
  bank: VocabularyBank,
  candidates: VocabularyCandidate[],
  context: string,
): VocabularyBank {
  const now = Date.now();
  const entries = [...bank.entries];

  candidates.forEach((candidate) => {
    const word = candidate.word.toLowerCase();
    const existing = entries.find((entry) => entry.word.toLowerCase() === word);

    if (existing) {
      existing.frequency += 1;
      existing.partOfSpeech = candidate.partOfSpeech;
      existing.lemma = candidate.lemma || existing.lemma;
      return;
    }

    entries.push({
      word: candidate.word,
      context,
      addedAt: now,
      frequency: 1,
      partOfSpeech: candidate.partOfSpeech,
      lemma: candidate.lemma,
    });
  });

  return {
    entries: entries.sort((a, b) => b.frequency - a.frequency),
    lastUpdated: now,
  };
}

export function loadVocabularyBank(): VocabularyBank {
  if (typeof window === 'undefined') {
    return { entries: [], lastUpdated: 0 };
  }

  try {
    const raw = window.localStorage.getItem('deutsch-lehrer-ai.vocabulary.v1');
    return raw ? JSON.parse(raw) : { entries: [], lastUpdated: 0 };
  } catch {
    return { entries: [], lastUpdated: 0 };
  }
}

export function saveVocabularyBank(bank: VocabularyBank): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem('deutsch-lehrer-ai.vocabulary.v1', JSON.stringify(bank));
}

export function clearVocabularyBank(): VocabularyBank {
  const empty: VocabularyBank = { entries: [], lastUpdated: Date.now() };

  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('deutsch-lehrer-ai.vocabulary.v1');
  }

  return empty;
}

export async function requestCoachReply(input: {
  topic: Topic;
  difficulty: number;
  topicIndex: number;
  turnCount: number;
  messages: ConversationMessage[];
}): Promise<TutorReply> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to fetch a coach reply.');
  }

  return (await response.json()) as TutorReply;
}

export async function requestWordForms(word: string): Promise<WordForms> {
  const response = await fetch('/api/word-forms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ word }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to fetch word forms.');
  }

  return (await response.json()) as WordForms;
}

export async function requestVocabularyCandidates(sentence: string): Promise<VocabularyCandidate[]> {
  const response = await fetch('/api/vocabulary/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sentence }),
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { items?: VocabularyCandidate[] };
  return Array.isArray(payload.items) ? payload.items : [];
}
