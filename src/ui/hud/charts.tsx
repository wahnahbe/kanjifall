import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tokenColor } from '../../design/palette';
import type { StatsOverview } from '../../shared/api';

type LevelStat = StatsOverview['levels'][number];
type TrendPoint = StatsOverview['trend'][number];
type LeechRow = StatsOverview['leeches'][number];

/** Display order N5 -> N2 (spec §5.1: JLPT N-numbers decrease as proficiency increases, but the
 *  learner reads the board beginner-to-advanced left-to-right / top-to-bottom). */
const LEVELS_DESC = [5, 4, 3, 2] as const;

/** Plain divs, not a Recharts BarChart — deliberately test-friendlier (see task brief) and there's
 *  no real charting need for four static bars. */
export function LevelBars({ levels }: { levels: LevelStat[] }) {
  const byLevel = new Map(levels.map((row) => [row.level, row]));
  return (
    <div className="level-bars">
      {LEVELS_DESC.map((level) => {
        const row = byLevel.get(level);
        const coveragePct = Math.round((row?.coverage ?? 0) * 100);
        const masteryPct = Math.round((row?.mastery ?? 0) * 100);
        return (
          <div key={level} className="level-bar" data-testid={`level-bar-${level}`}>
            <div className="level-bar-row">
              <span className="level-bar-label">N{level}</span>
              <div className="level-bar-track">
                <div className="level-bar-fill coverage" style={{ width: `${coveragePct}%` }} />
              </div>
              <div className="level-bar-track">
                <div className="level-bar-fill mastery" style={{ width: `${masteryPct}%` }} />
              </div>
            </div>
            <span className="hint">{coveragePct}% coverage · {masteryPct}% mastery</span>
          </div>
        );
      })}
    </div>
  );
}

/** Recharts renders an effectively-empty SVG under jsdom (no layout engine, no text measurement) —
 *  tests assert the `trend-chart` wrapper's presence only, never chart internals (see task brief). */
export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const axisColor = tokenColor('--color-ink-faint', '#737d97');
  const ground = tokenColor('--color-ground-lift', '#0a0d16');
  const line = tokenColor('--color-line', 'rgba(0, 229, 255, 0.32)');
  const ink = tokenColor('--color-ink', '#f6f1e6');
  const radiusSm = tokenColor('--radius-sm', '2px');
  return (
    <div className="trend-chart" data-testid="trend-chart">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={trend}>
          <XAxis dataKey="date" tick={false} axisLine={false} stroke={axisColor} />
          <YAxis yAxisId="words" hide domain={[0, 'auto']} stroke={axisColor} />
          <YAxis yAxisId="accuracy" orientation="right" hide domain={[0, 1]} stroke={axisColor} />
          <Tooltip
            contentStyle={{ background: ground, border: `1px solid ${line}`, borderRadius: radiusSm }}
            labelStyle={{ color: axisColor }}
            itemStyle={{ color: ink }}
          />
          {/* Spec §9.4: two series must not be told apart by hue alone — words is a solid line,
              accuracy is dashed, so the difference survives grayscale/colour-blind viewing too. */}
          <Line
            yAxisId="words" type="monotone" dataKey="words"
            stroke={tokenColor('--color-system', '#00e5ff')} dot={false} strokeWidth={2}
          />
          <Line
            yAxisId="accuracy" type="monotone" dataKey="accuracy"
            stroke={ink} dot={false} strokeWidth={2} strokeDasharray="6 4"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One cell per `trend` day (the server always sends exactly `STATS.trendDays` (30) entries, one per
 *  calendar day ending today — see statsHelpers.ts), lit up when that date appears in `streakDates`.
 *  Reusing `trend`'s own dates (rather than recomputing "today" client-side) keeps this in lockstep
 *  with the server's UTC day-bucketing instead of risking a client-clock/timezone mismatch. */
export function StreakGrid({ trend, streakDates }: { trend: TrendPoint[]; streakDates: string[] }) {
  const active = new Set(streakDates);
  return (
    <div className="streak-grid" data-testid="streak-grid">
      {trend.map(({ date }) => (
        <div key={date} className={active.has(date) ? 'streak-cell active' : 'streak-cell'} title={date} />
      ))}
    </div>
  );
}

export function LeechTable({ leeches }: { leeches: LeechRow[] }) {
  return (
    <table className="leech-table" data-testid="leech-table">
      <tbody>
        {leeches.map((leech) => (
          <tr key={leech.cardId}>
            <td>{leech.kanji ?? '—'}</td>
            <td>{leech.kana}</td>
            <td>{leech.gloss}</td>
            <td>{leech.strength}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
