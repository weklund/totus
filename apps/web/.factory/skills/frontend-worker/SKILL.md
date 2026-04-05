---
name: frontend-worker
description: Implements React components, dashboard pages, hooks, and UI flows for the dashboard frontend
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:

- React components (MetricStrip, BaselineBand, InsightCard, etc.)
- Dashboard view pages (Night, Recovery, Trend)
- React Query data fetching hooks
- Dashboard routing and navigation
- Component tests with testing-library

## Required Skills

- `agent-browser` — MUST invoke for manual verification of UI rendering and interactions. After implementing visual components or pages, use agent-browser to navigate to the page and verify it renders correctly.

## Work Procedure

1. **Read context**: Read `AGENTS.md`, `.factory/library/architecture.md`, and the feature description. Read the wireframes at `/docs/design/wireframes.md` for visual specs. Read user scenarios at `/docs/design/user-scenarios.md` for interaction context.

2. **Read existing patterns**: Before writing new code, read existing frontend files:
   - For components: read `src/components/dashboard/` existing files (MetricChart, IntradayChart, etc.)
   - For pages: read `src/app/dashboard/page.tsx` and `src/app/dashboard/layout.tsx`
   - For hooks: read `src/hooks/` existing hooks (useConnections, useSeriesData, etc.)
   - For tests: read existing component tests

3. **Read API response types**: Check the TypeScript interfaces in `src/lib/dashboard/types.ts` to understand the data shapes your components will receive.

4. **Write component tests first (TDD)**:
   - Write tests in `src/components/dashboard/__tests__/{component}.test.tsx`
   - Test rendering with mock data, interaction handlers, edge cases (empty data, loading)
   - Run tests and verify they FAIL

5. **Implement the component/page**:
   - Follow existing component patterns and design system tokens
   - Use Recharts for charts (already installed: Area, Line, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea)
   - Use `"use client"` directive for interactive components
   - Design system colors: `--totus-ocean` (#1E5B7B), `--totus-emerald` (#2FA87B), `--totus-coral` (#E8845A)
   - Baseline bands: metric color at 10% opacity
   - Status colors: critical=coral, warning=amber, normal=slate, good=emerald

6. **Run tests and verify they PASS**

7. **Run validators**:
   - `npm run typecheck` — must pass
   - `npm run lint` — must pass

8. **Manual verification with agent-browser**:
   - Navigate to the page/component on http://localhost:3100/dashboard
   - Verify visual rendering matches wireframe spec
   - Test key interactions (click, dismiss, navigate)
   - Check for console errors
   - Record observations in handoff `interactiveChecks`

## Example Handoff

```json
{
  "salientSummary": "Implemented MetricStrip component with BaselineBand, expand/collapse, and DeltaBadge. Verified via agent-browser that baseline bands render correctly with shaded normal range and delta badge shows polarity-aware colors.",
  "whatWasImplemented": "src/components/dashboard/MetricStrip.tsx — Recharts-based sparkline strip with BaselineBand overlay (avg +/- 1 SD), expand/collapse on header click, and DeltaBadge showing delta-from-avg with color coding. Also created src/components/dashboard/BaselineBand.tsx and src/components/dashboard/DeltaBadge.tsx as sub-components.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm run test -- src/components/dashboard/__tests__/MetricStrip.test.tsx --reporter=verbose",
        "exitCode": 0,
        "observation": "8 tests passed"
      },
      {
        "command": "npm run typecheck",
        "exitCode": 0,
        "observation": "No errors"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Navigate to /dashboard, locate MetricStrip for HRV",
        "observed": "Sparkline renders with shaded baseline band (avg 44 +/- 8 ms). DeltaBadge shows '-12 ms' in coral color (worse). Expand on click shows full Y-axis."
      },
      {
        "action": "Check console for errors",
        "observed": "No console errors. No React warnings."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/components/dashboard/__tests__/MetricStrip.test.tsx",
        "cases": [
          {
            "name": "renders sparkline with baseline band",
            "verifies": "visual rendering"
          },
          {
            "name": "expand/collapse toggles on header click",
            "verifies": "interaction"
          },
          {
            "name": "DeltaBadge shows correct polarity color",
            "verifies": "polarity-aware display"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- API endpoint not returning expected data shape (backend feature not complete)
- Recharts cannot render the required visualization (need alternative library)
- Design system tokens don't exist for required colors/spacing
- Component requires data that isn't available from any existing API endpoint
- Existing dashboard layout conflicts with new component placement
