import { useState } from 'react';
import { useEngine } from './ui/useEngine';
import { GameScreen } from './ui/screens/GameScreen';
import { TitleScreen } from './ui/screens/TitleScreen';

export default function App() {
  const [started, setStarted] = useState(false);
  const { snapshot, hostRef, start } = useEngine();

  const begin = () => {
    start();
    setStarted(true);
  };

  return started
    ? <GameScreen snapshot={snapshot} hostRef={hostRef} onRestart={begin} />
    : <TitleScreen onStart={begin} />;
}
