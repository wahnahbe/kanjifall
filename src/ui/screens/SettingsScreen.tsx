import { updateSettings } from '../../data/settings';
import { useSettings } from '../useSettings';

interface SettingsScreenProps {
  onBack: () => void;
}

/** Live-applied device settings (juice-pass spec §3.2): no save button —
 *  every control writes through the store, and the running stage/audio
 *  subscribe to the same store. */
export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const settings = useSettings();
  return (
    <div className="screen-center" data-testid="settings">
      <h2>Settings</h2>
      <label htmlFor="sound-toggle">
        <input
          id="sound-toggle"
          data-testid="sound-toggle"
          type="checkbox"
          checked={settings.sound}
          onChange={(e) => updateSettings({ sound: e.target.checked })}
        />{' '}
        Sound
      </label>
      <label htmlFor="volume-slider">
        Volume{' '}
        <input
          id="volume-slider"
          data-testid="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          disabled={!settings.sound}
          onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
        />
      </label>
      <div className="picker-row" role="radiogroup" aria-label="Effects level">
        {(['full', 'reduced', 'off'] as const).map((level) => (
          <button
            key={level}
            data-testid={`effects-${level}`}
            className={settings.effects === level ? 'picker selected' : 'picker'}
            role="radio"
            aria-checked={settings.effects === level}
            onClick={() => updateSettings({ effects: level })}
          >
            {level}
          </button>
        ))}
      </div>
      <label htmlFor="crt-toggle">
        <input
          id="crt-toggle"
          data-testid="crt-toggle"
          type="checkbox"
          checked={settings.crt}
          onChange={(e) => updateSettings({ crt: e.target.checked })}
        />{' '}
        CRT
      </label>
      <div className="picker-row">
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
