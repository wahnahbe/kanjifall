interface TitleScreenProps {
  onStart: () => void;
  onStats: () => void;
  onSettings: () => void;
}

export function TitleScreen({ onStart, onStats, onSettings }: TitleScreenProps) {
  return (
    <div className="screen-center">
      <div className="title-mark">
        <h1 className="title-word">KanjiFall</h1>
        <div className="title-rule" />
      </div>
      <p className="title-tagline">Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
      <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
      <button className="primary" data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
      <button data-testid="stats-button" onClick={onStats}>Stats</button>
      <button data-testid="settings-button" onClick={onSettings}>Settings</button>
    </div>
  );
}
