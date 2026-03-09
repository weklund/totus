# Totus MVP Product Requirements Document

### Version 1.0 – March 2026

### Founder: Wes Eklund

### Status: Approved for build

## Elevator Pitch

Totus is a web-first personal health data vault that gives quantified-self users and metabolic-health trackers complete ownership of their biometric data. It unifies Oura Ring (and soon CGM + scales via Apple Health/Google Fit), delivers beautiful long-term trend visualization, and makes it dead-simple to securely share exactly the slice a doctor, coach, or trainer needs — for exactly as long as they need it. Users stay in full control with scoped, time-limited, revocable links and a complete audit log. No screenshots. No extra logins. No vendor lock-in.

## Problem

Data lives in silos (Oura app, Dexcom Clarity, Withings, etc.). Sharing with doctors is painful and insecure. Users want one pane of glass + true custody. Users also don't know what platforms are doing with their data.

## MVP Goals (ranked)

Eliminate doctor-sharing friction (objective data in <60 seconds).
Deliver magical long-term trend visualization for QS users.
Prove users trust us with their most sensitive health data.
Hit 500 sign-ups in first 60 days (free tier).

## Target Users

Primary: Oura + CGM + Garmin users who see doctors/coaches regularly.
Secondary: Doctors/coaches (view-only via share links — no account needed).

## Core MVP Features

### Dashboard

One-click Oura OAuth connection
Interactive timeline (sleep score, RHR, HRV, steps, readiness, readiness)
Filters, overlays (up to 3 metrics), zoom 1 week–5 years

### Secure Sharing (killer feature)

Wizard: pick metric(s) + date range + expiration (7/30 days/custom) + note
Generates unique, unguessable link → clean read-only viewer
Full management page: revoke instantly, view history

### Transparency

Personal activity audit log (imports, share creation, every link view with timestamp/IP)

### Data Control

Manual CSV upload (legacy glucose/health data)
Full export / selective delete

Quick Win (v1.1 – within 2 weeks of launch)
Apple Health + Google Fit / Health Connect (instantly adds most CGMs + scales) - not sure I can connect but let's check
Connect with Garmin and Oura

## Non-Functional (non-negotiable)

AWS KMS per-user encryption at rest
Signed, auto-expiring share links + instant revocation
Clear fine grained permissions per ingested data
Immutable audit log
2FA, HTTPS, GDPR-aligned
Dashboard loads <2s even with years of data
OpenAPI compliant api

## Out of Scope (MVP)

AI insights, native mobile apps, direct Whoop, persistent group sharing, PDF branding.

Success Metrics

70% of users create ≥1 share link in first 30 days
Avg session >12 min
NPS ≥70
Zero security incidents

Roadmap
Phase 2: Full Health Connect + basic correlations
Phase 3: Direct integrations + AI highlights
Phase 4: API + doctor partnerships
