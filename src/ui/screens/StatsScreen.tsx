import { useCallback, useEffect, useState } from 'react';
import { profileSchema, statsOverviewSchema, type Profile, type StatsOverview } from '../../shared/api';
import { LeechTable, LevelBars, StreakGrid, TrendChart } from '../hud/charts';
import { ServerErrorScreen, type ServerErrorInfo } from './ServerErrorScreen';

const TARGET_LEVELS = [5, 4, 3, 2] as const;
const DAILY_GOAL_MIN = 1;
const DAILY_GOAL_MAX = 500;

interface DbErrorDetail {
  path: string;
  message: string;
  recovery: string;
}

function isDbErrorBody(body: unknown): body is { dbError: DbErrorDetail } {
  if (typeof body !== 'object' || body === null || !('dbError' in body)) return false;
  const detail: unknown = (body as { dbError: unknown }).dbError;
  return (
    typeof detail === 'object' && detail !== null
    && 'path' in detail && 'message' in detail && 'recovery' in detail
  );
}

/** Thrown only for a 503 whose body carries the `{ dbError }` shape (server.ts's DB-down catch-all —
 *  see server/app.ts). Any other failure (network rejection, other status, bad JSON) is left as a
 *  plain Error / rejection and mapped to the "server-down" variant by `toServerErrorInfo` below. */
class DbError extends Error {
  readonly path: string;
  readonly recovery: string;

  constructor(detail: DbErrorDetail) {
    super(detail.message);
    this.name = 'DbError';
    this.path = detail.path;
    this.recovery = detail.recovery;
  }
}

/** Thrown for any other non-ok response (i.e. not a dbError-shaped 503) — same shape as
 *  `apiClient.ts`'s `ApiError`, defined locally rather than imported (this file already owns a
 *  small fetch layer instead of extending `apiClient`; see Design Decision 1, m3-task-6-report.md).
 *  Carrying `status` lets the save path distinguish a 400 validation failure from everything else
 *  (Important #3) without touching initial-load's error handling at all: `toServerErrorInfo` below
 *  still only special-cases `DbError`, so an `HttpError` resolves to the same "server-down"
 *  `ServerErrorInfo` a plain `Error` did before this type existed. */
class HttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`request failed with status ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function parseOrThrow(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 503 && isDbErrorBody(body)) throw new DbError(body.dbError);
  if (!response.ok) throw new HttpError(response.status);
  return body;
}

async function getJson(url: string): Promise<unknown> {
  return parseOrThrow(await fetch(url));
}

async function putJson(url: string, payload: unknown): Promise<unknown> {
  return parseOrThrow(await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

/** Error precedence (task brief): a dbError-shaped 503 always renders the DB variant; every other
 *  failure — network rejection, non-503 status, schema-invalid body — renders the server-down
 *  variant ("start the app with npm run dev or npm start"). Used for INITIAL LOAD (and retry) only —
 *  a save failure never reaches this function; see `saveErrorMessage` below. */
function toServerErrorInfo(error: unknown): ServerErrorInfo {
  if (error instanceof DbError) {
    return { kind: 'db', path: error.path, message: error.message, recovery: error.recovery };
  }
  return { kind: 'serverDown' };
}

const SAVE_ERROR_VALIDATION = 'Could not save — check the values and try again.';
const SAVE_ERROR_SERVER = 'Could not save — is the server running?';

/** A failed profile save must not destroy the screen (Important #3): it never routes through
 *  `ServerErrorScreen` / `toServerErrorInfo` — it only ever picks one of these two inline messages.
 *  A 400 is assumed to be the draft failing server-side validation (the reproducible trigger was an
 *  empty exam date; see the `required` attribute added to that input below). Anything else —
 *  network rejection, a dbError-shaped 503, any other status — reuses the generic "is the server
 *  running?" copy, since there's nothing more specific to tell the user. */
function saveErrorMessage(error: unknown): string {
  if (error instanceof HttpError && error.status === 400) return SAVE_ERROR_VALIDATION;
  return SAVE_ERROR_SERVER;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; info: ServerErrorInfo }
  | { phase: 'ready'; overview: StatsOverview; profile: Profile };

interface StatsScreenProps {
  onBack: () => void;
}

export function StatsScreen({ onBack }: StatsScreenProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      // Fetched in parallel (task brief); issued in this fixed order (overview, then profile) so the
      // recorded fetch call sequence is deterministic for tests and for anyone reading a network trace.
      const [overviewJson, profileJson] = await Promise.all([
        getJson('/api/stats/overview'),
        getJson('/api/profile'),
      ]);
      setState({
        phase: 'ready',
        overview: statsOverviewSchema.parse(overviewJson),
        profile: profileSchema.parse(profileJson),
      });
    } catch (error: unknown) {
      setState({ phase: 'error', info: toServerErrorInfo(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = useCallback(async (draft: Profile) => {
    // Important #2: re-entry guard — a second Save while one is already in flight is a no-op.
    if (saving) return;
    setSaving(true);
    try {
      const saved = profileSchema.parse(await putJson('/api/profile', draft));
      // Pace depends on the profile (target level / exam date / daily goal), so re-pull the overview
      // rather than trusting the pre-save numbers still in state.
      const overview = statsOverviewSchema.parse(await getJson('/api/stats/overview'));
      setState({ phase: 'ready', overview, profile: saved });
      setSaveError(null);
    } catch (error: unknown) {
      // Important #3: stay on the stats view with the draft intact — a save failure never falls
      // through to ServerErrorScreen the way an initial-load failure does (see `load` above).
      setSaveError(saveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [saving]);

  if (state.phase === 'loading') {
    return (
      <div className="screen-center" data-testid="stats-loading">
        <p>Loading stats…</p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return <ServerErrorScreen info={state.info} onRetry={() => void load()} onBack={onBack} />;
  }

  const { overview, profile } = state;

  return (
    <div className="stats-screen" data-testid="stats-screen">
      <h2>Your stats</h2>

      <section>
        <p>
          Reading <strong data-testid="learned-reading">{overview.learned.reading}</strong> · Recall{' '}
          <strong data-testid="learned-recall">{overview.learned.recall}</strong>
        </p>
      </section>

      <section>
        <p data-testid="estimated-level">
          Estimated level: {overview.estimatedLevel === null ? '—' : `N${overview.estimatedLevel}`}
        </p>
        <p className="hint">vocab-only estimate</p>
        <LevelBars levels={overview.levels} />
      </section>

      <section className="pace-panel" data-testid="pace-panel">
        <h3>Pace</h3>
        <p>{overview.pace.onPace ? 'On pace ✓' : 'Behind pace ✗'}</p>
        <p>
          Learning {overview.pace.learnRatePerDay.toFixed(1)}/day, need{' '}
          {overview.pace.requiredRatePerDay.toFixed(1)}/day ({overview.pace.daysToExam} days to exam)
        </p>
      </section>

      <section>
        <TrendChart trend={overview.trend} />
        <StreakGrid trend={overview.trend} streakDates={overview.streakDates} />
      </section>

      <section>
        <LeechTable leeches={overview.leeches} />
      </section>

      <ProfileForm
        profile={profile}
        onSave={(draft) => void saveProfile(draft)}
        saving={saving}
        error={saveError}
        onDraftChange={() => setSaveError(null)}
      />

      <button onClick={onBack}>Back</button>
    </div>
  );
}

interface ProfileFormProps {
  profile: Profile;
  onSave: (draft: Profile) => void;
  saving: boolean;
  error: string | null;
  onDraftChange: () => void;
}

/** Local draft state re-seeds from `profile` whenever a fresh one arrives (initial mount via the
 *  useState initializer, then a new object from the parent's post-save refetch) — an intentional
 *  derived-state resync. A failed save leaves `profile`'s reference untouched (Important #3), so
 *  the draft — including whatever edit triggered the failure — survives exactly as the user left
 *  it.
 *
 *  The resync must run DURING RENDER (React's "adjusting state when a prop changes" pattern),
 *  not in a `useEffect([profile])`: an effect flushes asynchronously, so its mount invocation can
 *  land AFTER an edit made between the ready-state commit and the passive-effect flush — at which
 *  point setDraft(profile) is no longer a no-op and silently reverts the edit. That race was the
 *  intermittent coverage-run failure of the Important #3a test. */
function ProfileForm({ profile, onSave, saving, error, onDraftChange }: ProfileFormProps) {
  const [draft, setDraft] = useState<Profile>(profile);
  const [seededFrom, setSeededFrom] = useState<Profile>(profile);
  if (seededFrom !== profile) {
    setSeededFrom(profile);
    setDraft(profile);
  }

  const updateDraft = (next: Profile) => {
    setDraft(next);
    onDraftChange();
  };

  return (
    <form
      className="profile-form"
      data-testid="profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <label htmlFor="target-level">Target level</label>
      <select
        id="target-level"
        value={draft.targetLevel}
        onChange={(event) =>
          updateDraft({ ...draft, targetLevel: Number(event.target.value) as Profile['targetLevel'] })}
      >
        {TARGET_LEVELS.map((level) => (
          <option key={level} value={level}>N{level}</option>
        ))}
      </select>

      <label htmlFor="exam-date">Exam date</label>
      <input
        id="exam-date"
        type="date"
        required
        value={draft.examDate}
        onChange={(event) => updateDraft({ ...draft, examDate: event.target.value })}
      />

      <label htmlFor="daily-goal">Daily goal</label>
      <input
        id="daily-goal"
        type="number"
        min={DAILY_GOAL_MIN}
        max={DAILY_GOAL_MAX}
        value={draft.dailyWordGoal}
        onChange={(event) => updateDraft({ ...draft, dailyWordGoal: Number(event.target.value) })}
      />

      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {error !== null && <p data-testid="profile-error">{error}</p>}
    </form>
  );
}
