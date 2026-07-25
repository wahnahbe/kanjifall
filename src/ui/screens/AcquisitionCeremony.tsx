import { useCallback, useEffect, useRef, useState } from 'react';
import { InputBuffer } from '../../engine/InputBuffer';
import { matchesReading } from '../../engine/matcher';
import type { Card } from '../../engine/types';

interface AcquisitionCeremonyProps {
  cards: Card[];
  onIntroduced: (cardId: string) => void;
  onComplete: () => void;
}

/**
 * The moment a word becomes yours (spec §3.1): one new word at a time, with
 * its meaning, an example sentence and its kanji parts, typed once with no
 * timer and nothing falling. Enter advances only on a correct reading;
 * Escape always skips — a word you can't type must never trap you, and a
 * skip still counts as introduced because you did see it.
 */
export function AcquisitionCeremony({ cards, onIntroduced, onComplete }: AcquisitionCeremonyProps) {
  const [index, setIndex] = useState(0);
  const [buffer] = useState(() => new InputBuffer());
  const [kana, setKana] = useState('');
  const [rejected, setRejected] = useState(false);
  const card = cards[index];

  const done = cards.length === 0 || index >= cards.length;
  const completedRef = useRef(false);
  useEffect(() => {
    if (done && !completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }, [done, onComplete]);

  const advance = useCallback(
    (cardId: string) => {
      onIntroduced(cardId);
      buffer.clear();
      setKana('');
      setRejected(false);
      setIndex((i) => i + 1);
    },
    [buffer, onIntroduced],
  );

  useEffect(() => {
    if (card === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        advance(card.id);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (matchesReading(buffer.commitKana(), card)) advance(card.id);
        else {
          setRejected(true);
          buffer.clear();
          setKana('');
        }
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        buffer.backspace();
        setKana(buffer.kana);
        setRejected(false);
        return;
      }
      if (/^[a-zA-Z-]$/.test(e.key)) {
        e.preventDefault();
        buffer.pushKey(e.key);
        setKana(buffer.kana);
        setRejected(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, buffer, card]);

  if (card === undefined) return null;

  return (
    <div className="overlay ceremony" data-testid="ceremony">
      <p className="ceremony-label">New word</p>
      <p className="ceremony-word">{card.kanji ?? card.kana[0]}</p>
      <p className="ceremony-reading" data-testid="ceremony-reading">{card.kana[0]}</p>
      <p className="ceremony-gloss">{card.gloss}</p>

      {card.kanjiParts && (
        <p className="ceremony-parts" data-testid="ceremony-parts">
          {card.kanjiParts.map((part) => `${part.char} = ${part.meaning}`).join('　·　')}
        </p>
      )}

      {card.sentence && (
        <div className="ceremony-sentence" data-testid="ceremony-sentence">
          <p className="ceremony-sentence-ja">{card.sentence.ja}</p>
          <p className="ceremony-sentence-en">{card.sentence.en}</p>
        </div>
      )}

      <p className={rejected ? 'ceremony-buffer rejected' : 'ceremony-buffer'} data-testid="ceremony-buffer">
        {kana || ' '}
      </p>
      <p className="hint">
        Type it once, then Enter{cards.length > 1 ? ` · ${index + 1} of ${cards.length}` : ''} · Esc to skip
      </p>
      {card.sentence && <p className="ceremony-credit">Sentence: Tatoeba (CC-BY 2.0 FR)</p>}
    </div>
  );
}
