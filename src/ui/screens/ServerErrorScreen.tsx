/** The two ways StatsScreen's fetch-both-on-mount can fail (see spec precedence rule in the task
 *  brief): a 503 whose body carries the `{ dbError }` shape (server is up, DB failed to open — show
 *  the exact path/recovery the server reported), or anything else (network rejection, other HTTP
 *  status, bad JSON) — treated as "the dev/server process itself isn't running". */
export type ServerErrorInfo =
  | { kind: 'db'; path: string; message: string; recovery: string }
  | { kind: 'serverDown' };

interface ServerErrorScreenProps {
  info: ServerErrorInfo;
  onRetry: () => void;
  onBack: () => void;
}

export function ServerErrorScreen({ info, onRetry, onBack }: ServerErrorScreenProps) {
  return (
    <div className="screen-center">
      {info.kind === 'db' ? (
        <div data-testid="db-error">
          <h2>Database problem</h2>
          <p>{info.message}</p>
          <p className="hint">Path: {info.path}</p>
          <p>{info.recovery}</p>
        </div>
      ) : (
        <div data-testid="server-down">
          <h2>Server not reachable</h2>
          <p>Start the app with npm run dev or npm start, then retry.</p>
        </div>
      )}
      <div className="picker-row">
        <button onClick={onRetry}>Retry</button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
