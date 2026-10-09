import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeResponse,
  buildSessionSummary,
  createOpeningPrompt,
  createSessionId,
  getTopicByIndex,
  requestCoachReply,
  PracticeSession,
  SessionSummary,
  TOPICS,
  ConversationMessage,
  TurnReview,
  addVocabularyCandidatesToBank,
  loadVocabularyBank,
  clearVocabularyBank,
  requestVocabularyCandidates,
  saveVocabularyBank,
  VocabularyBank,
  VocabularyEntry,
  requestWordForms,
} from './lib/coach';

type Message = {
  id: string;
  role: 'coach' | 'user';
  text: string;
  timestamp: number;
};

type StoredSession = PracticeSession & {
  topicLabel: string;
};

const STORAGE_KEY = 'deutsch-lehrer-ai.sessions.v1';

function loadSessions(): StoredSession[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: StoredSession[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function formatDifficulty(level: number): string {
  const labels = ['A1', 'A2', 'B1', 'B2', 'C1'];
  return labels[level - 1] ?? 'B1';
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function App() {
  const [savedSessions, setSavedSessions] = useState<StoredSession[]>(() => loadSessions());
  const [vocabularyBank, setVocabularyBank] = useState<VocabularyBank>(() => loadVocabularyBank());
  const [topicIndex, setTopicIndex] = useState(0);
  const [difficulty, setDifficulty] = useState(2);
  const [autoDifficulty, setAutoDifficulty] = useState(true);
  const [detectedDifficulty, setDetectedDifficulty] = useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turnReviews, setTurnReviews] = useState<TurnReview[]>([]);
  const [input, setInput] = useState('');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [recognitionStatus, setRecognitionStatus] = useState<'idle' | 'unsupported' | 'listening'>('idle');
  const [sessionId, setSessionId] = useState(createSessionId());
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [turnCount, setTurnCount] = useState(0);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [expandedWord, setExpandedWord] = useState<string | null>(null);
  const [loadingWordForms, setLoadingWordForms] = useState<Record<string, boolean>>({});
  const [failedWordForms, setFailedWordForms] = useState<Record<string, boolean>>({});
  const recognitionRef = useRef<any>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const topic = useMemo(() => getTopicByIndex(topicIndex), [topicIndex]);

  useEffect(() => {
    saveSessions(savedSessions);
  }, [savedSessions]);

  useEffect(() => {
    saveVocabularyBank(vocabularyBank);
  }, [vocabularyBank]);

  useEffect(() => {
    const opening = createOpeningPrompt(topic, difficulty);
    setMessages([
      {
        id: `${sessionId}-opening`,
        role: 'coach',
        text: opening,
        timestamp: Date.now(),
      },
    ]);
    setTurnReviews([]);
    setSummary(null);
  }, [sessionId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, summary]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort?.();
      }
    };
  }, []);

  function fetchWordDetails(word: string) {
    setLoadingWordForms((current) => ({ ...current, [word]: true }));
    setFailedWordForms((current) => ({ ...current, [word]: false }));

    void requestWordForms(word)
      .then((forms) => {
        setVocabularyBank((current) => ({
          ...current,
          entries: current.entries.map((entry) => (entry.word === word ? { ...entry, forms } : entry)),
        }));
      })
      .catch((error) => {
        console.error(`Failed to fetch details for "${word}":`, error);
        setFailedWordForms((current) => ({ ...current, [word]: true }));
      })
      .finally(() => {
        setLoadingWordForms((current) => ({ ...current, [word]: false }));
      });
  }

  function toggleWordDetails(entry: VocabularyEntry) {
    if (expandedWord === entry.word) {
      setExpandedWord(null);
      return;
    }

    setExpandedWord(entry.word);

    if (!entry.forms && !loadingWordForms[entry.word]) {
      fetchWordDetails(entry.word);
    }
  }

  function chooseNextTopic(nextTurnCount: number): number {
    if (nextTurnCount > 0 && nextTurnCount % 3 === 0) {
      return (topicIndex + 1) % TOPICS.length;
    }

    return topicIndex;
  }

  function appendCoachMessage(text: string) {
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'coach', text, timestamp: Date.now() },
    ]);
  }

  async function handleUserMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || summary || isResponding) {
      return;
    }

    setIsResponding(true);
    const currentDifficulty = difficulty;
    const review = analyzeResponse(trimmed, topic, currentDifficulty);
    const nextTurnCount = turnCount + 1;
    const fallbackTopicIndex = chooseNextTopic(nextTurnCount);
    const conversationMessages: ConversationMessage[] = [
      ...messages.map((message) => ({ role: message.role, text: message.text })),
      { role: 'user', text: trimmed },
    ];

    void requestVocabularyCandidates(trimmed)
      .then((candidates) => {
        if (candidates.length === 0) {
          return;
        }

        setVocabularyBank((current) => addVocabularyCandidatesToBank(current, candidates, trimmed));
      })
      .catch((error) => {
        console.error('Vocabulary extraction failed:', error);
      });

    let replyText = '';
    let nextDifficulty = review.difficultyAfter;
    let nextTopicIndex = fallbackTopicIndex;

    const userMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-user`,
      role: 'user' as const,
      text: trimmed,
      timestamp: Date.now(),
    };

    setMessages((current) => [...current, userMessage]);

    setTurnReviews((current) => [...current, review]);
    setTurnCount(nextTurnCount);
    setInput('');

    try {
      const reply = await requestCoachReply({
        topic,
        difficulty: currentDifficulty,
        topicIndex,
        turnCount: nextTurnCount,
        messages: conversationMessages,
      });

      replyText = reply.reply.trim();
      if (Number.isFinite(reply.difficulty)) {
        const detected = Math.min(5, Math.max(1, reply.difficulty));
        setDetectedDifficulty(detected);
        if (autoDifficulty) {
          nextDifficulty = detected;
        } else {
          nextDifficulty = currentDifficulty;
        }
      } else {
        nextDifficulty = currentDifficulty;
      }

      if (Number.isFinite(reply.topicIndex)) {
        nextTopicIndex = Math.min(TOPICS.length - 1, Math.max(0, reply.topicIndex));
      }
    } catch (error) {
      const nextTopic = getTopicByIndex(fallbackTopicIndex);
      replyText =
        nextTopic.followUps[nextTurnCount % nextTopic.followUps.length] +
        ' Antworte bitte weiter auf Deutsch.';
      console.error('Coach reply failed, using fallback:', error);
    } finally {
      setIsResponding(false);
    }

    const finalReply = replyText || 'Erzähl mir bitte etwas mehr auf Deutsch.';
    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-coach`,
        role: 'coach',
        text: finalReply,
        timestamp: Date.now(),
      },
    ]);

    setDifficulty(nextDifficulty);
    setTopicIndex(nextTopicIndex);
  }

  function startNewSession() {
    setSessionId(createSessionId());
    setDifficulty(2);
    setAutoDifficulty(true);
    setDetectedDifficulty(null);
    setTopicIndex((current) => (current + 1) % TOPICS.length);
    setTurnCount(0);
    setStartedAt(Date.now());
  }

  function selectDifficulty(level: number) {
    setDifficulty(level);
    setAutoDifficulty(false);
  }

  function enableAutoDifficulty() {
    setAutoDifficulty(true);
    if (detectedDifficulty !== null) {
      setDifficulty(detectedDifficulty);
    }
  }

  function applyDetectedDifficulty() {
    if (detectedDifficulty === null) {
      return;
    }
    setDifficulty(detectedDifficulty);
  }

  function handleClearVocabulary() {
    if (vocabularyBank.entries.length === 0) {
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm('Clear all vocabulary bank entries? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    setVocabularyBank(clearVocabularyBank());
    setLoadingWordForms({});
    setFailedWordForms({});
    setExpandedWord(null);
  }

  function endSession() {
    if (turnReviews.length === 0) {
      appendCoachMessage('Wir haben noch keine Antwort gesammelt. Sprich etwas in deutscher Sprache, dann kann ich dein Feedback zusammenfassen.');
      return;
    }

    const session: PracticeSession = {
      id: sessionId,
      startedAt,
      endedAt: Date.now(),
      topicId: topic.id,
      turns: turnReviews,
      finalDifficulty: difficulty,
    };

    const currentTopic = getTopicByIndex(topicIndex);
    const sessionSummary = buildSessionSummary(session, currentTopic);
    setSummary(sessionSummary);
    setSavedSessions((current) => [
      {
        ...session,
        topicLabel: currentTopic.label,
      },
      ...current,
    ].slice(0, 8));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleUserMessage(input);
  }

  function startVoiceCapture() {
    if (typeof window === 'undefined') {
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setRecognitionStatus('unsupported');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop?.();
    }

    const recognition = new Recognition();
    recognition.lang = 'de-DE';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setRecognitionStatus('listening');
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();

      if (transcript) {
        setInput(transcript);
        void handleUserMessage(transcript);
      }
    };

    recognition.onerror = () => {
      setRecognitionStatus('idle');
      setIsListening(false);
    };

    recognition.onend = () => {
      setRecognitionStatus('idle');
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <div className={`min-h-screen transition-colors duration-200 ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'}`}>
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <header className={`mb-4 flex items-center justify-between rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <div>
            <h1 className="text-2xl font-bold">Deutsch Lehrer AI</h1>
            <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Conversation coach with local Ollama</p>
          </div>
          <button
            type="button"
            onClick={() => setIsDarkMode((value) => !value)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'}`}
          >
            {isDarkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className={`lg:col-span-2 rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Conversation</h2>
                <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                  Topic: <span className="font-semibold">{topic.label}</span> · Level: <span className="font-semibold">{formatDifficulty(difficulty)}</span>{' '}
                  <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                    ({autoDifficulty ? 'auto-detected from your answers' : 'manually set'})
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {['A1', 'A2', 'B1', 'B2', 'C1'].map((label, index) => {
                    const level = index + 1;
                    const isActive = difficulty === level;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => selectDifficulty(level)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                          isActive
                            ? 'bg-purple-600 text-white'
                            : isDarkMode
                              ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                        aria-pressed={isActive}
                      >
                        {label}
                      </button>
                    );
                  })}
                  {!autoDifficulty ? (
                    <button
                      type="button"
                      onClick={enableAutoDifficulty}
                      className={`ml-1 rounded-md px-2 py-1 text-xs font-semibold ${isDarkMode ? 'bg-slate-800 text-emerald-400 hover:bg-slate-700' : 'bg-slate-200 text-emerald-700 hover:bg-slate-300'}`}
                    >
                      ↻ Auto-detect
                    </button>
                  ) : null}
                </div>
                {!autoDifficulty && detectedDifficulty !== null && detectedDifficulty !== difficulty ? (
                  <div className={`mt-2 flex items-center gap-2 rounded-md px-2 py-1 text-xs ${isDarkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-100 text-amber-800'}`}>
                    <span>Your last answer looks like {formatDifficulty(detectedDifficulty)}.</span>
                    <button
                      type="button"
                      onClick={applyDetectedDifficulty}
                      className={`rounded px-2 py-0.5 font-semibold underline-offset-2 hover:underline`}
                    >
                      Apply {formatDifficulty(detectedDifficulty)}
                    </button>
                  </div>
                ) : null}
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'}`}>
                {isResponding ? 'Thinking…' : isListening ? 'Listening…' : recognitionStatus === 'unsupported' ? 'Mic not supported' : 'Ready'}
              </span>
            </div>

            <div className={`h-96 overflow-y-auto rounded-lg p-3 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`} aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`mb-3 ${message.role === 'coach' ? 'text-left' : 'text-right'}`}>
                  <div className={`mb-1 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    <span>{message.role === 'coach' ? 'Coach' : 'You'}</span>
                    <span className="ml-2">{formatTimestamp(message.timestamp)}</span>
                  </div>
                  <div
                    className={`inline-block max-w-[80%] rounded-lg px-3 py-2 ${
                      message.role === 'coach'
                        ? isDarkMode
                          ? 'bg-slate-700 text-slate-100'
                          : 'bg-slate-200 text-slate-900'
                        : 'bg-purple-600 text-white'
                    }`}
                  >
                    <p>{message.text}</p>
                  </div>
                </article>
              ))}

              {isResponding ? (
                <article className="mb-3 text-left">
                  <div className={`mb-1 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Coach</div>
                  <div className={`inline-flex rounded-lg px-3 py-2 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                    <div className="thinking-dots flex gap-1">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </article>
              ) : null}

              <div ref={listEndRef} />
            </div>

            <form className="mt-3 grid gap-3" onSubmit={handleSubmit}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Type your German response or use the microphone"
                rows={4}
                disabled={Boolean(summary)}
                className={`w-full rounded-lg border p-3 ${isDarkMode ? 'border-slate-700 bg-slate-800 text-slate-100' : 'border-slate-300 bg-white text-slate-900'}`}
              />
              <div className="flex gap-3">
                <button
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'}`}
                  type="button"
                  onClick={startVoiceCapture}
                  disabled={Boolean(summary)}
                >
                  {isListening ? 'Listening…' : 'Use microphone'}
                </button>
                <button
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
                  type="submit"
                  disabled={Boolean(summary) || !input.trim() || isResponding}
                >
                  {isResponding ? 'Sending…' : 'Send reply'}
                </button>
                <button
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'}`}
                  type="button"
                  onClick={startNewSession}
                >
                  New session
                </button>
                <button
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'}`}
                  type="button"
                  onClick={endSession}
                >
                  Finish
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-4">
            <section className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide">Session Stats</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className={`rounded-lg p-2 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <div className="text-xs opacity-70">Turns</div>
                  <div className="text-lg font-bold">{turnCount}</div>
                </div>
                <div className={`rounded-lg p-2 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <div className="text-xs opacity-70">Level</div>
                  <div className="text-lg font-bold">{formatDifficulty(difficulty)}</div>
                </div>
              </div>
            </section>

            <section className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide">Vocabulary Bank</h3>
                <div className="flex items-center gap-2">
                  {vocabularyBank.entries.length > 0 ? (
                    <button
                      className={`rounded px-2 py-1 text-xs ${isDarkMode ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                      type="button"
                      onClick={handleClearVocabulary}
                    >
                      🗑 Clear all
                    </button>
                  ) : null}
                  <button
                    className={`rounded px-2 py-1 text-xs ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300'}`}
                    type="button"
                    onClick={() => setShowVocabulary((value) => !value)}
                  >
                    {showVocabulary ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {showVocabulary ? (
                vocabularyBank.entries.length > 0 ? (
                  <div className="space-y-1.5">
                    {vocabularyBank.entries.slice(0, 30).map((entry: VocabularyEntry) => {
                      const isOpen = expandedWord === entry.word;
                      const posBadgeColor =
                        entry.partOfSpeech === 'verb'
                          ? isDarkMode ? 'bg-sky-900/50 text-sky-300' : 'bg-sky-100 text-sky-700'
                          : entry.partOfSpeech === 'noun'
                            ? isDarkMode ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                            : entry.partOfSpeech === 'adjective'
                              ? isDarkMode ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-700'
                              : isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600';

                      return (
                        <div key={entry.word} className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                          <button
                            type="button"
                            onClick={() => toggleWordDetails(entry)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                            aria-expanded={isOpen}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${posBadgeColor}`}>
                                {entry.partOfSpeech ? entry.partOfSpeech.slice(0, 4) : '?'}
                              </span>
                              <span className="truncate font-semibold text-purple-400">{entry.word}</span>
                              <span className="text-xs opacity-60">×{entry.frequency}</span>
                            </span>
                            <span className={`shrink-0 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                          </button>

                          {isOpen ? (
                            <div className={`space-y-2 border-t px-3 py-3 text-xs ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                              <p className="opacity-70">Context: <span className="italic">"{entry.context.slice(0, 90)}{entry.context.length > 90 ? '…' : ''}"</span></p>

                              {loadingWordForms[entry.word] ? (
                                <p className="opacity-70">Loading grammar details…</p>
                              ) : failedWordForms[entry.word] ? (
                                <div className="space-y-1">
                                  <p className="opacity-70">Could not load grammar details right now.</p>
                                  <button
                                    type="button"
                                    onClick={() => fetchWordDetails(entry.word)}
                                    className={`rounded px-2 py-1 text-xs font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'}`}
                                  >
                                    Retry
                                  </button>
                                </div>
                              ) : entry.forms ? (
                                <div className="space-y-3">
                                  {entry.forms.translation ? (
                                    <p>
                                      <span className="opacity-70">English: </span>
                                      <strong>{entry.forms.translation}</strong>
                                    </p>
                                  ) : null}

                                  {entry.forms.partOfSpeech === 'noun' ? (
                                    <div className="space-y-2">
                                      <p>
                                        <span className="opacity-70">Article · Plural: </span>
                                        <strong>{entry.forms.article || '—'} {entry.lemma || entry.word}</strong>
                                        <span className="opacity-70"> · </span>
                                        <strong>{entry.forms.plural || '—'}</strong>
                                      </p>
                                      <div className={`rounded p-2 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
                                        <p className="mb-1 font-semibold opacity-80">Declension</p>
                                        <p>Nominativ: <strong>{entry.forms.cases.nominativ || '—'}</strong></p>
                                        <p>Akkusativ: <strong>{entry.forms.cases.akkusativ || '—'}</strong></p>
                                        <p>Dativ: <strong>{entry.forms.cases.dativ || '—'}</strong></p>
                                        <p>Genitiv: <strong>{entry.forms.cases.genitiv || '—'}</strong></p>
                                      </div>
                                      {entry.forms.relatedVerbs.length > 0 ? (
                                        <div>
                                          <p className="mb-1 font-semibold opacity-80">Common verbs used with this noun</p>
                                          <div className="flex flex-wrap gap-1">
                                            {entry.forms.relatedVerbs.map((verb) => (
                                              <span key={verb} className={`rounded px-1.5 py-0.5 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                                {verb}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}

                                  {entry.forms.partOfSpeech === 'verb' ? (
                                    <div className="space-y-2">
                                      <p>
                                        <span className="opacity-70">Infinitive: </span>
                                        <strong>{entry.forms.infinitive || '—'}</strong>
                                        {entry.forms.auxiliary ? (
                                          <span className="opacity-70"> · Aux: <strong>{entry.forms.auxiliary}</strong></span>
                                        ) : null}
                                        {entry.forms.governs ? (
                                          <span className="opacity-70"> · Governs: <strong>{entry.forms.governs}</strong></span>
                                        ) : null}
                                      </p>
                                      <div className="grid grid-cols-1 gap-1">
                                        <p>Präsens: <strong>{entry.forms.present || '—'}</strong></p>
                                        <p>Präteritum: <strong>{entry.forms.past || '—'}</strong></p>
                                        <p>Perfekt: <strong>{entry.forms.perfect || '—'}</strong></p>
                                        <p>Futur: <strong>{entry.forms.future || '—'}</strong></p>
                                        {entry.forms.imperative ? <p>Imperativ: <strong>{entry.forms.imperative}</strong></p> : null}
                                      </div>
                                      <div className={`rounded p-2 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
                                        <p className="mb-1 font-semibold opacity-80">Präsens conjugation</p>
                                        <p>ich: <strong>{entry.forms.conjugation.ich || '—'}</strong></p>
                                        <p>du: <strong>{entry.forms.conjugation.du || '—'}</strong></p>
                                        <p>er/sie/es: <strong>{entry.forms.conjugation.erSieEs || '—'}</strong></p>
                                        <p>wir: <strong>{entry.forms.conjugation.wir || '—'}</strong></p>
                                        <p>ihr: <strong>{entry.forms.conjugation.ihr || '—'}</strong></p>
                                        <p>sie/Sie: <strong>{entry.forms.conjugation.sie || '—'}</strong></p>
                                      </div>
                                    </div>
                                  ) : null}

                                  {entry.forms.partOfSpeech === 'adjective' ? (
                                    <div className="space-y-2">
                                      <p>
                                        <span className="opacity-70">Komparativ · Superlativ: </span>
                                        <strong>{entry.forms.comparative || '—'}</strong>
                                        <span className="opacity-70"> · </span>
                                        <strong>{entry.forms.superlative || '—'}</strong>
                                      </p>
                                      {entry.forms.commonVerbs.length > 0 ? (
                                        <div>
                                          <p className="mb-1 font-semibold opacity-80">Common verbs used with this adjective</p>
                                          <div className="flex flex-wrap gap-1">
                                            {entry.forms.commonVerbs.map((verb) => (
                                              <span key={verb} className={`rounded px-1.5 py-0.5 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                                                {verb}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      ) : null}
                                      <div className={`overflow-x-auto rounded p-2 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
                                        <p className="mb-1 font-semibold opacity-80">Declension endings (with definite article)</p>
                                        <table className="w-full min-w-[320px] border-collapse text-left">
                                          <thead>
                                            <tr className="opacity-70">
                                              <th className="pr-2 pb-1">Case</th>
                                              <th className="pr-2 pb-1">mask.</th>
                                              <th className="pr-2 pb-1">fem.</th>
                                              <th className="pr-2 pb-1">neut.</th>
                                              <th className="pb-1">plural</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(['nominativ', 'akkusativ', 'dativ', 'genitiv'] as const).map((caseKey) => (
                                              <tr key={caseKey}>
                                                <td className="pr-2 py-0.5 capitalize opacity-80">{caseKey}</td>
                                                <td className="pr-2 py-0.5"><strong>{entry.forms!.declension[caseKey].maskulin || '—'}</strong></td>
                                                <td className="pr-2 py-0.5"><strong>{entry.forms!.declension[caseKey].feminin || '—'}</strong></td>
                                                <td className="pr-2 py-0.5"><strong>{entry.forms!.declension[caseKey].neutrum || '—'}</strong></td>
                                                <td className="py-0.5"><strong>{entry.forms!.declension[caseKey].plural || '—'}</strong></td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ) : null}

                                  {entry.forms.notes ? <p className="opacity-70 italic">{entry.forms.notes}</p> : null}
                                </div>
                              ) : (
                                <p className="opacity-70">No details loaded yet.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm opacity-70">No vocabulary yet.</p>
                )
              ) : (
                <p className="text-sm opacity-70">Click Show to view saved words.</p>
              )}
            </section>
          </aside>
        </div>

        {summary ? (
          <section className={`mt-4 rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
            <h2 className="mb-1 text-lg font-semibold">End-of-session summary</h2>
            <p className={`mb-3 text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              {summary.sessionLabel} · {summary.topicLabel} · {summary.totalTurns} turns
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-semibold">Corrections</h3>
                {summary.corrections.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {summary.corrections.map((item, index) => (
                      <li key={`${item.before}-${index}`} className={`rounded-lg p-2 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                        <strong>{item.before}</strong> → <strong>{item.after}</strong>
                        <p className="opacity-80">{item.reason}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm opacity-70">No correction notes this time.</p>
                )}
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Words to reuse</h3>
                <div className="mb-4 flex flex-wrap gap-2">
                  {summary.recommendedWords.map((word) => (
                    <span key={word} className={`rounded-full px-3 py-1 text-sm ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>{word}</span>
                  ))}
                </div>
                <h3 className="mb-2 font-semibold">Strengths</h3>
                <ul className="space-y-2 text-sm">
                  {summary.strengths.length > 0 ? summary.strengths.map((item) => <li key={item}>• {item}</li>) : <li>Keep speaking and the app will track your strengths.</li>}
                </ul>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;
