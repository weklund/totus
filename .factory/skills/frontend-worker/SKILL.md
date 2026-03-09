---
name: frontend-worker
description: Implements React components, pages, hooks, and UI flows for the web application
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:

- React component implementation (RSC and Client Components)
- Page layouts and routing
- TanStack Query hooks for data fetching
- Form implementation (React Hook Form + Zod)
- shadcn/ui component installation and configuration
- Styling with Tailwind CSS
- Interactive UI flows (wizards, dialogs, filters)
- Responsive design and dark mode

## Work Procedure

1. **Read the feature description and design docs.** The primary reference for frontend work is `/docs/web-ui-lld.md`. Cross-reference with the architecture design for the unified viewer pattern. Read the feature's `expectedBehavior` and `verificationSteps` carefully.

2. **Read existing code.** Before implementing, understand what exists:
   - Check `src/components/` for existing components and patterns
   - Check `src/hooks/` for existing data fetching hooks
   - Check `src/lib/` for utilities (view-context, api-client, cn, etc.)
   - Check `src/app/` for existing page layouts
   - Check `.factory/library/` for notes from previous workers

3. **Install any needed shadcn/ui components first.** Use `bunx shadcn@latest add <component>` for any UI primitives needed. Check `src/components/ui/` for already-installed components before adding.

4. **Write tests FIRST (red).** Before implementing components:
   - For components with logic: Write tests using @testing-library/react
   - For hooks: Write tests covering data fetching states (loading, success, error)
   - For forms: Test validation behavior
   - For pages with auth gates: Test redirect behavior
   - Run `bun run test` — tests should FAIL (red phase)
   - Note: Pure presentation components with no logic may skip unit tests (validation will catch visual issues)

5. **Implement components (green).** Make tests pass:
   - Follow the component hierarchy from the LLD
   - Use `"use client"` directive ONLY when hooks/event handlers are needed
   - Use Tailwind CSS for all styling (no inline styles, no CSS modules)
   - Use shadcn/ui primitives for buttons, inputs, dialogs, etc.
   - Implement loading (skeleton), error (retry), and empty states for all data-dependent components
   - Use ViewContext for role-aware rendering (owner vs viewer)
   - Use TanStack Query for all client-side data fetching

6. **Run all verification commands:**
   - `bun run test` — all tests pass
   - `bun run typecheck` — zero errors
   - `bun run lint` — zero warnings

7. **Manual verification with agent-browser.** For every user-visible page or flow:
   - Start `bun dev` if not running
   - Use agent-browser to navigate to the page
   - Take screenshots verifying: layout renders correctly, interactive elements work, loading/error/empty states display
   - For forms: fill out and submit, verify behavior
   - For navigation: click through and verify routing
   - Stop dev server after testing
   - Each flow tested = one `interactiveChecks` entry with the full sequence and end-to-end outcome

8. **Update shared knowledge.** Add any component patterns, gotchas, or styling notes to `.factory/library/architecture.md`.

## Example Handoff

```json
{
  "salientSummary": "Implemented the Share Wizard (4-step form) with React Hook Form + Zod validation. All 4 steps render correctly: metric selection, date range, expiration, and review. Copy-to-clipboard works in the URL dialog. Ran 8 tests (all passing), verified the full wizard flow via agent-browser including form validation and share creation.",
  "whatWasImplemented": "Created ShareWizard.tsx, ShareWizardStepMetrics.tsx, ShareWizardStepDateRange.tsx, ShareWizardStepExpiration.tsx, ShareWizardStepReview.tsx, and ShareUrlDialog.tsx. Used React Hook Form with createShareSchema (Zod). Integrated useHealthDataTypes() to show available metrics and useCreateShare() mutation for submission. StepIndicator shows progress. Copy button uses useCopyToClipboard hook. URL dialog has 'This link will only be shown once' warning. Back/Next navigation validates current step before advancing.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run test -- --grep 'ShareWizard'",
        "exitCode": 0,
        "observation": "8 tests passing"
      },
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "No errors"
      },
      { "command": "bun run lint", "exitCode": 0, "observation": "No warnings" }
    ],
    "interactiveChecks": [
      {
        "action": "Navigated to /dashboard/share/new via agent-browser",
        "observed": "Step 1 (Metrics) renders with metric chips grouped by category"
      },
      {
        "action": "Selected sleep_score and hrv metrics, clicked Next",
        "observed": "Step 2 (Date Range) renders with presets and custom picker"
      },
      {
        "action": "Selected 'Last 90 days' preset, clicked Next",
        "observed": "Step 3 (Expiration) renders with 7/30/90 day options"
      },
      {
        "action": "Selected 30 days, clicked Next",
        "observed": "Step 4 (Review) shows summary of all selections"
      },
      {
        "action": "Clicked 'Create Share Link'",
        "observed": "ShareUrlDialog appeared with URL and copy button, toast: 'Share link created'"
      },
      {
        "action": "Tried to advance from Step 1 with no metrics selected",
        "observed": "Validation error: 'Select at least one metric'"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "src/components/share/__tests__/ShareWizard.test.tsx",
        "cases": [
          {
            "name": "renders step 1 with metric chips",
            "verifies": "initial render"
          },
          {
            "name": "validates minimum one metric selected",
            "verifies": "step 1 validation"
          },
          {
            "name": "navigates between steps",
            "verifies": "back/next navigation"
          },
          {
            "name": "submits share and shows URL dialog",
            "verifies": "creation flow"
          },
          {
            "name": "copy button copies URL to clipboard",
            "verifies": "clipboard integration"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required API endpoint is missing or returns unexpected responses
- A needed component dependency (shadcn/ui or other) fails to install
- Auth context or ViewContext is not available (auth layer not yet built)
- Data fetching hooks depend on API routes that don't exist yet
- Design doc is ambiguous about component behavior for a specific interaction
