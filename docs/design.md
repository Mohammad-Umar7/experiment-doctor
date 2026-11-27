# Design system

Direction: **a developer tool with the calm of an intensive-care monitor.** Roughly 80% premium dev tooling, 15% clinical visual language, 5% arcade. The heartbeat is memorable because everything around it is restrained.

## Rules

- Green means *verified healthy*. Red means *an actual failure we have evidence for*. Purple is for actions and brand. Gray means *unknown / not verified*. Never paint something green that the Doctor did not verify.
- No confetti, no screen shake, no full-screen flashes, no gradient headings, no glassmorphism.
- Dark theme only.
- Every status has an icon and a label, never color alone.

## Tokens

| Token | Value |
| --- | --- |
| canvas | `#090B0F` |
| surface | `#11141B` |
| elevated | `#181C25` |
| border | `#272D38` |
| healthy | `#22FF88` |
| critical | `#FF5263` |
| accent (Flagsmith purple) | `#6837FC` |
| warning | `#F5B942` |
| info | `#60A5FA` |
| text | `#F1F4F8` |
| text-secondary | `#A0A8B8` |
| text-muted | `#778195` |

Type: Geist Sans for UI, Geist Mono for data, code and timers (tabular numerals).

| Role | Size |
| --- | --- |
| Hero heading | 64px desktop / 40px mobile, 600, tracking -0.045em |
| Page heading | 32px, 600 |
| Card heading | 16px, 600 |
| Body | 14 to 16px, line-height 1.6 |
| Data / code | 13px mono |
| Timer | 48px mono, 500 |

Spacing scale 4, 8, 12, 16, 24, 32, 48, 64, 96. Radius: buttons 8, cards 12, hero monitor 16. Grid: 12 columns, 24px gutter, max width 1280px; mobile 4 columns, 16px padding.

Shadow `0 8px 32px rgba(0,0,0,.24)`. Healthy glow `0 0 24px rgba(34,255,136,.12)`. Critical glow `0 0 20px rgba(255,82,99,.10)`.

## Motion

Two curves: `smooth = [0.22, 1, 0.36, 1]`, `standard = [0.4, 0, 0.2, 1]`. Motion + CSS + SVG only.

| Animation | Timing |
| --- | --- |
| Hero entrance | 450ms, 60ms stagger, opacity + 12px rise |
| ECG sweep | 2.4s per cycle, linear |
| Pipeline signal | 280ms per connection |
| Failed node | 350ms single glow |
| Button hover / press | 140ms lift 1px / 100ms scale .98 |
| Hint reveal | 200ms |
| Verification charge | 400ms fill |
| Resurrection | 1400ms sequence |
| Leaderboard reorder | 300ms layout |
| Counter update | 450ms ease-out |
| A/B bar update | 600ms |

### The Resurrection (signature moment)

Runs only after the backend confirms a repair.

| Time | Action |
| --- | --- |
| 0ms | verification response received |
| 0 to 200ms | failed node turns from red to green |
| 200 to 700ms | green signal travels through the rest of the pipeline |
| 700 to 1000ms | the flatline produces its first heartbeat |
| 1000 to 1400ms | "EXPERIMENT REVIVED" fades in |
| 1400ms | verified result and share card appear |

One reusable component, used in the hero, the game success state and the report page.

## Accessibility

- `MotionConfig reducedMotion="user"`; with reduced motion the ECG is static and pulses do not travel.
- WCAG AA contrast, 44px touch targets, keyboard access everywhere, no flashing.
- Screen readers hear repair status changes, not timer ticks.
- Looping animations pause off-screen and in hidden tabs.

## Sound

Muted by default. Three tiny Web Audio tones: verify start (80ms click), success (two rising tones, 250ms), timeout (falling tone, 180ms).
