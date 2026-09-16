# DermClose AI

Benefit-aware prescribing assistant for **Harbor Dermatology**, built on Photon.

Clinicians ask whether a medication will be covered *before* an order goes out, then manage fulfillment exceptions and refill noise in one inbox.

## Setup

Secrets are **not** in this repo. Create a local env file before running:

1. Copy the example file:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` and set `PHOTON_ACCESS_TOKEN` to your Neutron sandbox user access token (from [app.neutron.health](https://app.neutron.health) — Network tab or a logged-in session).
3. Leave the `NEXT_PUBLIC_PHOTON_*` values as in `.env.example` (SPA client/org for Elements), or replace them with your own Photon sandbox credentials.
4. Optional: add `OPENAI_API_KEY` for freer LLM replies. Without it, the deterministic assistant still works.
5. Install and run:
   ```bash
   npm install
   npm run dev
   ```
6. Open [http://localhost:3000](http://localhost:3000) — you’ll hit a **demo sign-in** (email/password + 6-digit code). Use `clinician@harborderm.com` / `harbor123` / `424242`, then the assistant and inbox load. This is app-gate auth only; Photon Elements still uses Google SSO to actually sign a script.

**Do not commit `.env.local`.** It is gitignored. Never paste real tokens into the README or git history.

---

## Product sections & use cases

### 1. Prescribing assistant (home)

**Use case:** At visit close, the clinician asks about coverage for a derm medication and gets a recommendation plus optional drafts before anything is sent to a pharmacy.

**What you do**
- `@`-mention a patient (age / DOB / city — id stays behind the scenes)
- Ask about coverage or paste a visit note
- Review proposed drafts (requested + plan alternatives), then sign in Photon Elements

**Demo prompts**
- Covered: `Can we cover Adapalene for @Maya?`
- Restricted / PA path: `Can we cover Victoza for @Jordan?`
- Clinical hold: **Hold path** chip (Accutane / isotretinoin)

**Why it exists (clinician pain):** Doctors often learn about prior auth and coverage only after the pharmacy rejects the Rx.

- [I just did my first prior auth today](https://www.reddit.com/r/medicine/comments/1fepsi4/i_just_did_my_first_prior_auth_today_our_system/) — pharmacy bounce → clinic PA work → hours lost  
- [Prior authorization; or How I Became Radicalized](https://www.reddit.com/r/medicine/comments/1ufj0dp/prior_authorization_or_how_i_became_radicalized/) — full day on a denial that was already documented  

---

### 2. Clinic inbox → Problematic orders

**Use case:** After a prescription leaves the clinic, something breaks — out of stock, PA required, diagnosis flag, stuck routing, not covered. The inbox surfaces the problem and proposes a resolution (reroute, switch med, clarify, send-to-patient).

**What you do**
- Open **Inbox** in the doctor nav
- Expand **Problematic orders**
- Search / filter by severity or reason
- Accept the AI proposal or an alternate; or dismiss

**Why it exists (clinician pain):** Offices drown in faxes and calls when pharmacies can’t fill or need clarification.

---

### 3. Clinic inbox → Refill requests

**Use case:** Refill faxes and auto-requests pile up. The inbox auto-triages into approve / bridge / needs clinician (overdue visit, Accutane, early auto-refill spam).

**What you do**
- Expand **Refill requests** (stacked under orders; both sections collapse)
- Search / filter by severity or triage type
- One-click accept the proposed action

**Why it exists (clinician pain):** Pharmacies and portals generate refill volume that isn’t always patient-driven or clinically appropriate.

- [Refills not automatically honored](https://www.reddit.com/r/medicine/comments/159fwo3/refills_not_automatically_honored/) — fax attrition on refills and “confirm you meant this”  
- [CVS repeatedly tries to refill meds neither patient nor provider asked for](https://www.reddit.com/r/FamilyMedicine/comments/1hwpona/cvs_repeatedly_tries_to_refill_meds_neither/) — auto-outreach refill spam  

---

## Inbox demo data

**Refresh demo data** on `/inbox` reseeds ~60 derm scenarios (order exceptions + refill requests) tied to your Photon patients where possible — enough volume to exercise search, filters, collapse, and resolve flows.
