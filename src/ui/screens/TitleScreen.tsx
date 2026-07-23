export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen-center">
      <h1>kotoba-drop</h1>
      <p>Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
      <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
      <button data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
    </div>
  );
}
