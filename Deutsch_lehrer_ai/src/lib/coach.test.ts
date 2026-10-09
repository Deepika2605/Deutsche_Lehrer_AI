import { describe, expect, it } from 'vitest';
import {
  analyzeResponse,
  buildSessionSummary,
  createOpeningPrompt,
  getTopicByIndex,
} from './coach';

describe('coach helpers', () => {
  it('creates an opening prompt that matches the topic and difficulty', () => {
    const topic = getTopicByIndex(0);
    const prompt = createOpeningPrompt(topic, 4);

    expect(prompt).toContain(topic.opening.split('.')[0]);
    expect(prompt).toMatch(/Nebensatz|Abwägung/);
  });

  it('adapts difficulty and surfaces corrections', () => {
    const topic = getTopicByIndex(1);
    const review = analyzeResponse('I want a very good project and because it is nice', topic, 2);

    expect(review.corrections.length).toBeGreaterThan(0);
    expect(review.recommendedWords.length).toBeGreaterThan(0);
    expect(review.difficultyAfter).toBeGreaterThanOrEqual(1);
    expect(review.wordCount).toBeGreaterThan(0);
  });

  it('builds a summary from session turns', () => {
    const topic = getTopicByIndex(2);
    const review = analyzeResponse('Das Essen ist sehr gut und ich koche gern', topic, 2);
    const session = {
      id: 'session-test',
      startedAt: Date.now(),
      endedAt: Date.now(),
      topicId: topic.id,
      turns: [review],
      finalDifficulty: review.difficultyAfter,
    };

    const summary = buildSessionSummary(session, topic);

    expect(summary.totalTurns).toBe(1);
    expect(summary.recommendedWords.length).toBeGreaterThan(0);
    expect(summary.nextGoal.length).toBeGreaterThan(0);
  });
});
