# Seen Requires an Introduction — Fix Design

**Date:** 2026-08-09
**Status:** Implemented (single-task fix; no separate plan doc)
**Amends:** `2026-07-24-word-introduction-v2-design.md` §4.2 (the "new" definition) and `2026-07-27-tiered-vocabulary-design.md` §3.3 (the absorption mechanism) — see §7
**Builds on:** both of the above; composes with `2026-08-08-custom-list-import-design.md` §5.2 (list pools share the membership rule)

## 1. The leak

DB forensics (2026-08-09): 11 words (地下鉄, 左, 毎月, …) fell during the July 24 pre-plan-era runs, recorded attempts, and were classified "seen" by every plan computed afterward — permanently skipping their acquisition ceremony while continuing to circulate as review words. The database was reset that day (backup in `data/backup-20260809/`), but three live code paths can still produce attempts-without-introduction:

1. **No-plan fallback** — the plan fetch fails and `GameEngine` treats the entire pool as seen at uniform weight (word-intro §7: play never blocks on the API).
2. **Starved-pool rule** — budget 0 and an empty seen pool; waves compose from new cards without ceremonies (word-intro §3.2).
3. **Mid-run starved fallback** — `Spawner.drawSeen` falls back to still-un-introduced `newPool` cards when the seen pool is empty and the wave introduced nothing (Spawner.ts).

All three are spec-sanctioned "never blocks play" behavior and stay exactly as they are. The bug is what happens *next*: `computeRunPlan` classified any card with an attempt group OR an introductions row as seen, so a single recorded attempt permanently stripped a card of its ceremony. That contradicts the spec's own promise — §3.2: *"Those cards remain un-introduced, so they still get their acquisition moment on a later day when budget exists"* — and the matching comment on Spawner's fallback.

## 2. Why the old rule existed

§4.2's attempts clause was M4-A's absorption path for pre-plan history: the 39 cards already met before introductions existed had attempt rows and nothing else, and re-teaching them would have been wrong (tiered §3.3, "existing history is absorbed, not discarded"). That job ended with the 2026-08-09 reset. On a post-reset database every legitimately met card gains its introductions row *before* its first attempt — the ceremony precedes the spawn, and Escape-skip still introduces (§3.3 of word-intro). Attempts-without-introduction now occur **only** via the three fallback paths above, and for those the spec explicitly promises a later ceremony.

## 3. The fix

**Planning membership keys on introductions alone.** In `computeRunPlan` and `computeListRunPlan`:

- **seen** ⟺ the card has an `introductions` row. Weight comes from attempt history exactly as today (max weight when introduced-but-never-attempted, §3.4).
- **new** ⟺ not introduced AND in an active tier AND mode-reachable (list pools: not introduced AND not mode-unreachable).
- Everything else is **locked** (tiered §5.3), spawning nowhere.

Attempts keep the two jobs they genuinely have — knowledge evidence for the tier gate (solid/amnesty) and for review weights/stats — and lose the membership job that was only ever a migration shim.

Consequences, all intended:

- A card that fell without a ceremony re-enters `newCardIds` the next time its tier is active and budget exists — §3.2's promise, now actually true. Future poisoning self-heals on the next plan request for as long as the card's tier is active; a card whose tier passes on off-plan evidence alone instead goes locked un-ceremonied — the curriculum moved past it — until other members of its tier lose solid status and reopen the gate. That corner is the honest endpoint of the no-carve-out trade-off below.
- Off-plan attempts still count toward the gate and stats: real practice is real evidence.
- A never-introduced card whose tier has already passed is locked, not review-eligible — "not new no longer implies met" (tiered §5.3), applied consistently.
- Even a card driven *solid* by off-plan attempts stays new while its tier is active: it still gets its ceremony. A solidity carve-out was considered and rejected — it would re-create the reported symptom (a never-taught word circulating as review) behind a rarer trigger, and one invariant beats two. The cost is a rare redundant ceremony on a word learned entirely offline; the gate itself is untouched, so such a card can still help its tier pass.

## 4. Options considered

| Option | Verdict |
|---|---|
| **A. Planner: seen requires an introductions row** | **Chosen.** One predicate at the single point where membership is decided; covers all three paths, past and future; no schema change; the client fallback (§7) stays untouched. |
| B. Suppress attempt recording for never-introduced cards | Rejected. Lossy — off-plan runs vanish from stats, trend, and streak — and during a no-plan run the client has no plan, so it cannot even tell which cards are un-introduced. Breaks "one flush path" for nothing. |
| C. Mark null-plan runs unplanned; planner excludes their attempts | Rejected. Schema + join machinery, and it only covers path 1 — the starved-pool paths (2, 3) happen inside *planned* runs. Solves classification indirectly where A solves it directly. |

## 5. What does not change

- `GameEngine`'s no-plan fallback (word-intro §7) — mandated, verbatim.
- `Spawner`'s starved fallback (word-intro §3.2, tiered §7) — mandated; its comment's promise ("a later run … can still give them a proper acquisition moment") becomes true instead of aspirational.
- Tier-gate semantics (`classifyCard`) — attempts are knowledge evidence regardless of ceremony state.
- Stats — practice history is truth; nothing there keys on membership.
- `RunPlan` shape, API schema, routes, client, e2e flows.

## 6. Testing

- New planner tests (failing first): an attempted-but-never-introduced active-tier card is **new**; the same card outside the active tier is **locked** (in neither list); an attempted-but-never-introduced list member is **new**; a card driven solid without an introduction stays **new** while its tier is active (pins the no-carve-out decision).
- The M4-A test *"a card with an attempt or an introduction is seen"* narrows to introductions only.
- Attempt-only fixtures that meant "the player met this card" (review-weight tests, the far-tier absorbed-history test, the list met-member test) gain an introduction row — post-reset realism: real gameplay always introduces before attempting.

## 7. Doc amendments riding along

- word-intro §4.2: the definition drops its attempts clause — "new" means **no introduction row** — with a dated note pointing here.
- tiered §3.3: a dated note that absorption-by-attempts retired with the 2026-08-09 reset; history is absorbed through the gate and weights, not through membership.
