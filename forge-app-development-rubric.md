# Forge App Development Rubric & Promotion Standard

**Organization:** Wells Fargo
**Applies to:** All Atlassian Forge apps built by or for Wells Fargo, including internal tools, team utilities, and apps intended for staging or production sites.
**Designated development site:** `dev-wf.atlassian.net`
**Toolchain:** GitHub (source of truth) · GitHub Actions (CI, required today) · Harness (CD, Platform-operated for production) · Atlassian Developer Console
**Version:** 1.4 — Draft for Security, Platform Engineering & Enablement review

---

## 1. Purpose

This rubric defines what "production-grade" means for Forge apps at Wells Fargo and sets a phased path to get there. The intent during this initial period is to keep the development experience open enough that teams can build momentum, while holding a hard line at the boundary that matters: **nothing reaches staging or production without passing GitHub Actions CI, and nothing reaches production without Platform Engineering approval.** Apps are promoted between environments (Development → Staging → Production) based on their rubric score and their tier's gate requirements — not on who built them or how urgently they are wanted.

## 2. Roles

| Role | Responsibility in this standard |
|------|--------------------------------|
| **App team (builder)** | Owns the repo, the code, the manifest, and the rubric score. Requests promotion. |
| **Forge-certified reviewer** | Peer-reviews T2/T3 pull requests and manifest changes. |
| **Security** | Owns the egress allowlist, the web trigger (ingress) registry, and T3 sign-off. Sets policy. |
| **Platform Engineering** | **Owns the production boundary.** Operates Harness for production deploys, holds the production approval stage, verifies the pre-deploy checklist (Section 6), and blesses the manifest's egress/ingress posture against Security policy before any production deploy or install. Also owns the Forge service account and its credentials. |
| **Enablement** | Owns the golden path, the Manifest Scanner, templates, and onboarding. |

Platform Engineering's role here is the cloud-era continuation of what they did in the data center: they no longer administer file systems, but they still control what enters production and verify it is safe to run. Their approval is procedural teeth, not ceremony — a production deploy request they have not approved does not execute.

## 3. Phased Enforcement Model

| Phase | Timeframe | Development environment | Staging | Production |
|-------|-----------|------------------------|---------|------------|
| **Phase 1 (current)** | Now | `forge deploy` from developer workstations to the development environment on `dev-wf.atlassian.net` is **permitted**. A corresponding GitHub repo is still required (FR-1). | CI-passing commit on the default branch required. Deploys may be manual while Harness rollout completes. | **CI pass required + Platform Engineering approval required.** Production deploys and installs are executed only by Platform Engineering (via Harness where onboarded, via the service account otherwise), after completing the pre-deploy checklist. Egress and ingress review is in force **now** (Section 6). |
| **Phase 2 (target: ~6 months)** | H1 review | Desktop `forge deploy` retired; development deploys also flow through GitHub Actions. | Harness owns staging deploys. | Harness owns all production deploys with Platform Engineering as the pipeline approval stage; developers hold no deploy credentials for shared sites. |

Note what does *not* change between phases at the production boundary: Platform approval, CI gating, and egress/ingress review are Phase 1 controls. Phase 2 changes the *mechanics* (Harness everywhere, no manual paths), not the *authority*.

## 4. Foundational Rules (Non-Negotiable in Phase 1)

**FR-1 — Every deployed app has a corresponding Git repository.** All Forge apps deployed to *any* environment — including development on `dev-wf.atlassian.net` — must have a repository in the Wells Fargo GitHub organization. The `manifest.yml` in the default branch is the single source of truth. A deployed manifest that does not match the repo is a compliance incident, not a style issue. This rule has no exceptions process: an app whose code lives nowhere cannot be reviewed, patched, or trusted.

**FR-2 — Staging and production are CI-gated.** No app is deployed to or installed on a staging or production site unless the deployed commit has passed the GitHub Actions CI pipeline (Section 7). During Phase 1 the staging deploy step may be manual; the CI pass is what is non-negotiable.

**FR-3 — Production deploys are executed and approved by Platform Engineering only.** App teams do not deploy to production, in Phase 1 or ever. Platform Engineering executes production deploys and installs, and only after the pre-deploy checklist (Section 6) is complete. The Forge service account token is held by Platform Engineering in the Harness secrets manager; app teams never possess production credentials.

**FR-4 — Egress and ingress are controlled boundaries, effective now.** *Egress:* any `permissions.external` domain in a manifest must be on the Security-approved allowlist; traffic leaving the bank to an unapproved URL is a blocking finding at CI time and again at Platform review. Remember that Forge egress originates from Atlassian's infrastructure — it will never appear on bank network telemetry, so the manifest allowlist **is** the egress firewall for this platform. *Ingress:* web triggers expose an internet-reachable invocation surface; any app declaring one must be registered in the Security web-trigger registry, authenticate and authorize callers using WF-approved mechanisms only, and document the expected caller.

**FR-4a — No custom security implementations; zero trust everywhere else.** App teams do not design or build their own authentication, authorization, or credential-handling logic under any circumstance. Authentication and authorization use the WF-approved enterprise mechanisms, consumed via the approved shared libraries. Every other interaction — inter-app calls, remote backends, inbound web trigger traffic, downstream APIs — is treated as zero trust: no caller is trusted by virtue of network location, prior relationship, or being "internal"; every request is explicitly verified with least-privilege access. This posture is not optional hardening — Forge apps execute in Atlassian's infrastructure, outside the bank's network entirely, so there is no trusted perimeter to fall back on.

**FR-5 — Development never touches real data.** Apps in the Forge `development` environment may only be installed on `dev-wf.atlassian.net` or other designated sandbox sites. Staging and production sites receive only `staging`/`production`-environment deploys respectively.

**FR-6 — Every app has an owning team.** Ownership is assigned to a team, not an individual. Each app declares an owner team, a runbook location, and a decommission contact in its repo.

**FR-7 — Approved shared libraries are the default.** Wells Fargo maintains shared Forge libraries (WF-approved authN/authZ integration, logging, storage wrappers). For **security capabilities** (authentication, authorization, credential handling), the shared libraries are mandatory per FR-4a — there is no justification path for a hand-rolled alternative. For non-security capabilities, hand-rolled equivalents require a documented justification in the repo.

## 5. App Tiers

Review depth scales with risk. Tier is determined by the highest-risk attribute the app possesses.

| Tier | Definition | Examples | Review requirement |
|------|-----------|----------|-------------------|
| **T1 — Low ("Runs on Atlassian" posture)** | Zero `permissions.external`, no web triggers, no Forge Remote — data cannot leave Atlassian's infrastructure by construction. Read-only or minimal scopes, no user impersonation. | Read-only Confluence macro, Jira dashboard gadget | CI gate + Platform pre-deploy checklist. **No Security egress/ingress review** — the Manifest Scanner proves there is nothing to review. |
| **T2 — Moderate** | Write scopes and/or Forge storage of business data; zero egress, no web triggers | Issue auto-labeler, page templating tool | CI gate + peer review + Platform pre-deploy checklist |
| **T3 — High** | Any of: external egress, web triggers, Forge Remote, user impersonation, or access to Restricted-classified spaces/projects | Integration with an external SaaS, webhook receiver | CI gate + peer review + Security sign-off + Platform pre-deploy checklist with manifest blessing recorded |

Atlassian's platform behavior reinforces T3 review: scope, permission, or egress increases in a new version require admin re-approval at install time, so any permissions diff in a PR triggers tier re-evaluation — and re-triggers Platform's manifest blessing before the new version reaches production.

### 5.1 The "Runs on Atlassian" Fast Lane

"Runs on Atlassian" is Atlassian's Marketplace designation for Forge apps whose data never leaves Atlassian's infrastructure — no egress, no Forge Remote, all processing and storage inside Atlassian's boundary. This standard adopts the same criteria as a first-class internal concept:

- **Internal apps:** an app is in **RoA posture** when its manifest declares zero `permissions.external`, no Forge Remote, and no web triggers. This is verified mechanically by the Manifest Scanner on every push — it is a provable property of the manifest, not a self-attestation. RoA-posture apps are T1 by definition and bypass Security egress/ingress review entirely, because there is architecturally nothing to exfiltrate through.
- **What the fast lane does not waive:** repo (FR-1), CI (FR-2), Platform's production gate (FR-3), scope minimization, and ownership. An RoA-posture app with broad write scopes can still corrupt or destroy data at scale; RoA posture removes the *exfiltration* review, not the *blast radius* review.
- **Marketplace apps:** third-party apps carrying the actual Runs on Atlassian badge are installable through the standard admin request process without a Security deep-dive. Marketplace apps *without* the badge — meaning they egress or run remote compute — enter the T3 review path regardless of vendor reputation.
- **Losing the posture:** if a manifest change adds egress, Forge Remote, or a web trigger, the app exits the fast lane at that PR — the Scanner flags the tier change, Atlassian forces admin re-consent at install time, and the T3 requirements apply before the version reaches production.

The enablement message to builders is simple: **stay in RoA posture and your path to production is CI-speed.** This makes the secure architecture the fastest architecture, which is the strongest incentive this program has.

## 6. Platform Engineering Pre-Deploy Checklist (Production Gate)

Platform Engineering completes and records this checklist before executing any production deploy or install. Any unchecked item stops the deploy.

1. **CI green.** The exact commit being deployed has a passing GitHub Actions run — all tests, `forge lint`, dependency scan, and the Manifest Scanner. No overrides of failing or skipped required checks.
2. **Manifest blessing.** The deployed `manifest.yml` matches the default branch, and Platform has reviewed the Manifest Scanner's policy report: every egress domain is on the Security allowlist; every web trigger is registered and authenticates callers via WF-approved mechanisms; no custom security implementations are present (FR-4a); scopes match the app's declared tier baseline; any Forge Remote backend is registered.
3. **Permissions diff review.** If this version changes scopes, egress, or ingress relative to the currently installed version, the diff has been re-reviewed (and for T3, Security sign-off is attached), since the change will also prompt admin re-consent at install time.
4. **Tier and sign-offs.** The app's tier is current; required peer review and (for T3) Security sign-off are on record.
5. **Rubric threshold.** The app meets the promotion gate for its tier (Section 9).
6. **Rollback path.** The previous known-good version and rollback procedure are identified in the runbook.

The checklist result is recorded against the deploy (Harness approval stage where onboarded; the deploy ticket otherwise), giving an audit trail of who blessed what, when.

## 7. The Manifest Scanner

The Manifest Scanner is the centerpiece automated control and a named deliverable of the enablement program. It is a shared GitHub Actions workflow (consumed via `workflow_call` from a central repo, so every app inherits updates automatically) that:

1. Triggers on every push where a `manifest.yml` is present in the repository, and on every pull request — so out-of-band commits are scanned, not just PR merges.
2. Diffs `permissions.external` (fetch, images, scripts, styles) against the Security-approved egress allowlist maintained in a central policy repo. Any non-allowlisted domain fails the build.
3. Detects web trigger modules and verifies the app appears in the Security web-trigger registry; unregistered triggers fail the build.
4. Compares declared OAuth scopes against the approved baseline for the app's declared tier; out-of-baseline scopes fail the build.
5. Detects Forge Remote declarations and verifies the remote backend is registered.
6. Flags indicators of custom security implementations (e.g., hand-rolled token validation or secret comparison in web trigger handlers instead of the approved shared library imports) as a blocking finding per FR-4a. Static detection is best-effort; peer review and Platform blessing remain the backstop.
7. Emits a machine-readable policy report — including an explicit **RoA-posture determination** (true/false, with the manifest facts that support it) — attached to the PR as a check — the same report Platform Engineering reads during the pre-deploy checklist, so the manifest blessing is a verification of an automated result, not a manual YAML read.

Because the scanner is centrally versioned, tightening policy (including the Phase 2 cutover) is a change to one repo, not a campaign across hundreds.

## 8. Scoring Rubric

Score each axis 0–2. Maximum score: 12.

### Axis A — Source Control

| Score | Criteria |
|-------|----------|
| 0 | No repo, or repo exists but deployed code/manifest does not match it |
| 1 | Repo in Wells Fargo GitHub; default branch matches deployed manifest; direct pushes to main permitted |
| 2 | Protected default branch; all changes via pull request with at least one review; manifest changes require a Forge-certified reviewer |

### Axis B — CI (GitHub Actions)

| Score | Criteria |
|-------|----------|
| 0 | No CI workflow |
| 1 | Workflow runs lint + `forge lint` + unit tests + the shared Manifest Scanner on every PR |
| 2 | Score-1 items plus dependency vulnerability scanning and consumption of the org's shared CI workflow (not a divergent local copy) |

### Axis C — Deployment Discipline

| Score | Criteria |
|-------|----------|
| 0 | Staging/production deploys from arbitrary commits, or any production deploy not executed by Platform Engineering |
| 1 | **Phase 1 floor:** staging deploys only from CI-passing default-branch commits; all production deploys executed by Platform Engineering after the pre-deploy checklist; development deploys may be manual to `dev-wf.atlassian.net` |
| 2 | **Phase 2 posture:** Harness owns staging and production deploys and installs via the service account, with Platform Engineering as the production approval stage; developers hold no shared-site deploy credentials |

### Axis D — Manifest Hygiene (Egress & Ingress)

| Score | Criteria |
|-------|----------|
| 0 | Unreviewed scopes; egress to non-allowlisted domains; or unregistered web triggers |
| 1 | Minimal scopes for function; egress limited to allowlisted domains; web triggers registered and authenticating via WF-approved mechanisms; Manifest Scanner passing |
| 2 | Score-1 items plus documented justification in the repo for every scope, every egress domain, and every ingress surface — and zero egress where the app's function permits |

### Axis E — Shared Libraries & Standards

| Score | Criteria |
|-------|----------|
| 0 | Any custom authentication, authorization, or credential-handling code (automatic 0, and a blocking finding per FR-4a); or hand-rolled implementations of other covered capabilities without justification |
| 1 | WF-approved authN/authZ mechanisms consumed via approved shared libraries; shared libraries used for all other covered capabilities (logging, storage) |
| 2 | Score-1 items plus shared libraries consumed at pinned, current versions with automated update PRs; any deviation documented and approved |

### Axis F — Ownership & Lifecycle

| Score | Criteria |
|-------|----------|
| 0 | Owned by an individual or unowned; no versioning discipline; no decommission plan |
| 1 | Owning team declared; README with purpose and support channel; semantic versioning; lockfile committed |
| 2 | Score-1 items plus runbook (failure modes, rollback, ingress incident response), annual still-needed attestation, and a documented decommission procedure including uninstall and data disposition |

## 9. Promotion Gates

| Transition | Phase 1 requirement | Phase 2 requirement |
|-----------|--------------------|--------------------|
| Development → Staging | FR-1 through FR-7 satisfied; CI passing; score ≥ 5 with no axis at 0 | Score ≥ 6 with no axis at 0 |
| Staging → Production (T1/T2) | Score ≥ 8; Axes B and D at 2; Axis C at ≥ 1; Platform pre-deploy checklist complete | Score ≥ 9; Axes A, B, C at 2; Platform approval stage in Harness |
| Staging → Production (T3) | Score ≥ 9; Axes B and D at 2; Security sign-off; Platform checklist with manifest blessing recorded | Score ≥ 10; Axes A, B, C, D at 2; Security sign-off; Platform approval stage |
| Remaining in Production | Annual re-score; any manifest permission diff triggers re-score, Platform re-blessing, and for T3, Security re-review | Same |

## 10. Grandfathering Existing Apps

Existing deployed apps without repos are the highest-priority remediation class. Within 60 days of adoption: inventory all installed Forge apps via the Developer Console and the admin Connected Apps view; Platform Engineering runs the egress/ingress portions of the pre-deploy checklist against every currently installed production app as a retroactive audit. For each app, either (a) recover or rewrite the source into a Wells Fargo repo and onboard to CI, or (b) uninstall. Apps whose source cannot be recovered are treated as unowned software and scheduled for decommission. Any currently installed app with non-allowlisted egress or an unregistered web trigger is escalated to Security immediately rather than waiting out the 60-day window.

## 11. Onboarding & Enablement Path

Onboarding is where this program earns adoption, and it is resourced as a first-class workstream. The target: **a builder goes from app idea to a CI-passing repo on `dev-wf.atlassian.net` in under one day.**

The golden path consists of: a template repository containing a `forge create` scaffold, the shared CI workflow (including the Manifest Scanner) pre-wired, an approved T1 manifest skeleton, and the shared libraries pre-installed; a self-service intake that provisions the repo and registers the app in the inventory; and the "Forge the Right Way" onboarding curriculum covering Git fundamentals, GitHub Actions basics, manifest permissions, egress and ingress safety, the no-custom-security/zero-trust policy, and shared library usage. Git and GitHub Actions literacy is taught, not assumed — the builders most likely to create risk are typically those the tooling assumptions have left behind.

Platform Engineering participates in enablement as well: the pre-deploy checklist is published so app teams know exactly what will be verified, and Platform runs a standing office hour for teams approaching their first production promotion. Certification as a Forge reviewer (required for Axis A score-2 reviews and T2/T3 peer review) is granted after completing onboarding plus one shipped T1/T2 app. Enablement capacity is reviewed quarterly alongside the Phase 2 readiness assessment.
