'use client';
import { useEffect, useRef, useState } from 'react';
import { loadCheckpoint, saveCheckpoint } from '../lib/checkpoints';
import { z } from 'zod';
import { quizQuestions } from './questions';
import type { GameProps } from './types';
export default function QuizGame({ game, onEnd, paused, owner }: GameProps) {
  const [saved] = useState(() => {
    const parsed = z
      .object({
        questions: z
          .array(
            z.object({
              prompt: z.string(),
              answer: z.string(),
              choices: z.array(z.string()).length(4),
              flag: z.string().optional(),
            }),
          )
          .length(10),
        index: z.number().int().min(0).max(9),
        selected: z.string().nullable(),
        correct: z.number().int().min(0).max(10),
        answers: z.array(z.string()).max(10),
        times: z.array(z.number()).max(10),
      })
      .safeParse(loadCheckpoint(owner, game.id)?.data);
    return parsed.success ? parsed.data : null;
  });
  const [questions] = useState(() => saved?.questions || quizQuestions(game.id)),
    [index, setIndex] = useState(saved?.index || 0),
    [selected, setSelected] = useState<string | null>(saved?.selected || null),
    [correct, setCorrect] = useState(saved?.correct || 0);
  const answers = useRef<string[]>(saved?.answers || []),
    began = useRef(Date.now()),
    times = useRef<number[]>(saved?.times || []),
    ended = useRef(false);
  const q = questions[index];
  useEffect(() => {
    began.current = Date.now();
  }, [index]);
  useEffect(() => {
    if (!ended.current)
      saveCheckpoint(owner, game.id, {
        questions,
        index,
        selected,
        correct,
        answers: answers.current,
        times: times.current,
      });
  }, [index, selected, correct]);
  function answer(choice: string) {
    if (selected || paused || ended.current) return;
    setSelected(choice);
    times.current.push(Date.now() - began.current);
    answers.current.push(choice);
    if (choice === q.answer) setCorrect((n) => n + 1);
  }
  function next() {
    if (index === 9) {
      if (ended.current) return;
      ended.current = true;
      onEnd({
        score: correct * 100,
        durationMs: times.current.reduce((a, b) => a + b, 0),
        won: correct >= 7,
        stats: {
          correct,
          total: 10,
          accuracy: correct * 10,
          answers: JSON.stringify(
            questions.map((q, i) => ({
              question: q.prompt,
              flag: q.flag,
              chosen: answers.current[i],
              correct: q.answer,
              responseMs: times.current[i],
            })),
          ),
          responseMs: times.current.reduce((a, b) => a + b, 0),
          quiz: game.id,
        },
      });
    } else {
      setIndex((n) => n + 1);
      setSelected(null);
    }
  }
  return (
    <div className="quiz">
      <div className="quiz-top">
        <span>DOMANDA {index + 1} / 10</span>
        <span>{correct} corrette</span>
      </div>
      <h2>
        {q.flag && (
          <span className="flag" role="img" aria-label="Bandiera da riconoscere">
            {q.flag}
          </span>
        )}
        {q.prompt}
      </h2>
      <div className="answers">
        {q.choices.map((choice, i) => (
          <button
            key={choice}
            disabled={!!selected || paused}
            className={
              selected ? (choice === q.answer ? 'correct' : choice === selected ? 'wrong' : '') : ''
            }
            onClick={() => answer(choice)}
          >
            <span style={{ opacity: 0.4, marginRight: 15 }}>{String(i + 1).padStart(2, '0')}</span>
            {choice}
          </button>
        ))}
      </div>
      <div className="quiz-feedback" aria-live="polite">
        {selected && (
          <>
            <span>{selected === q.answer ? 'Esatto.' : 'Risposta: ' + q.answer}</span>
            <br />
            <button className="primary" onClick={next}>
              {index === 9 ? 'Vedi risultato' : 'Prossima domanda'} ↗
            </button>
          </>
        )}
      </div>
    </div>
  );
}
