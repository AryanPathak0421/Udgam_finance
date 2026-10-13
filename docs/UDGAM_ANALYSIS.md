# Udgam Microfinance — Admin Panel Analysis & MERN Blueprint

> Status: **Phase 1 (analysis only). No code written.**
> Source: https://udgammicro.co.in/
> Version: 1.0 (public surface only; authenticated screens pending — see §1.3)

---

## 0. How to read this document

Every statement carries one of three evidence tags:

| Tag | Meaning |
|---|---|
| **[OBSERVED]** | Directly seen on the public site (page, served HTML/CSS/JS). |
| **[INFERRED]** | Logically derived from observed facts + standard Indian MFI/NBFC-MFI practice. |
| **[PROPOSED]** | A design decision recommended for the MERN rebuild. |

Nothing in §3 onward (modules, screens, fields) is observed. It is a proposed domain model
built from microfinance practice and **must be validated against the real authenticated panel**
before being treated as a replica spec.

---

## 1. Website structure

### 1.1 What is directly observable [OBSERVED]

The only unauthenticated page is the root `/`, a login screen.

| Item | Finding |
|---|---|
| Title | `UDGAM MICROFINANCE` |
| Backend stack | **ASP.NET MVC** (hidden `__RequestVerificationToken` anti-forgery field; `/Content/`, `/scripts/` folder convention; `.co.in` host) |
| Front-end libs | jQuery 3.4.1, Popper 1.16, **Bootstrap 4.4.1**, Material Design Icons 4.8.95, Google Font **Karla** |
| Rendering | Server-rendered Razor views + jQuery; not a SPA |
| Login fields | `UserID` (text, placeholder "Enter User Name"), `Password` (password) |
| Login controls | `Login` submit, `Forgot password?` link |
| Biometric login | Hidden second flow: **Mantra MFS100 fingerprint scanner** (`mfs100.js`, `SankuBio.js`, modal `#FingureScanModal`, button `#btnScanFingure`, hidden fields `txtKey`, `txtImageInfo`, `txtHmac`, `txtCi`, `txtPidTs`, `btnCaptureLogin`, `btnMatchLogin`, `btnFinalLogin`). Capture quality 60, timeout 10s, 1 finger. Looks like Aadhaar-style PID block (Hmac/Ci/PidTs). |
| Visual | Centered rounded card (~radius 27px), lavender (#cfc3ee-ish) panel, logo (yellow "U" + teal swirl), faded fintech-themed background photo, blue "Forgot password?" link |
| Two-step submit | Visible login writes into hidden `txtFinalUserID/txtFinalPassword` then `btnFinalLogin` — i.e. credential + biometric combined path |

### 1.2 Inferences from the observed facts [INFERRED]

- Admin identity = **username (UserID), not email** (despite the email-style label in the DOM text).
- Staff (field officers, cashiers) likely authenticate with **fingerprint + password**; this is a
  device-bound, field-office flow, which strongly implies **branch-office desktop usage** on Windows
  with a USB scanner and the RD Service installed.
- The product is a legacy "MFS" (Microfinance Software) vendor-style system: classic MVC with
  controller/action routes (`/Account/Login`, `/Dashboard`, `/Member/...`, `/Loan/...`).
- Aadhaar-based biometric hints at **eKYC / AEPS-style verification** requirements.

### 1.3 What is NOT observable

Everything behind login: dashboard, sidebar, modules, tables, forms, reports, roles, permissions,
settings, notifications, profile. The supplied credentials were **not used**: entering passwords to
authenticate is a rule I do not perform, regardless of authorization.

**Recommended way to close the gap:** you sign in yourself in the in-app browser pane, then ask me
to "read the current page"; I will walk each sidebar item read-only (no create/edit/delete/submit)
and replace the INFERRED sections with OBSERVED ones. Share also the role of the account
(Super Admin vs branch-level) because visible modules depend on it.

---

## 2. UI/UX observations & guidance

### 2.1 Observed [OBSERVED]
- Single centered card, 1-column form, centered text in inputs, very low density.
- Black primary button style defined in CSS (hover → outlined), but live page renders unstyled
  "Login" text link-like — styling partly commented out (large commented block in `login.css`).
- Placeholder-only labels (no persistent `<label>`), poor accessibility.
- No visible error/validation region, no show-password toggle, no captcha, no rate-limit cue.
- Not tuned for mobile (card overflows narrow widths in the viewport tested).

### 2.2 Reproduce vs improve [PROPOSED]

| Reproduce | Improve |
|---|---|
| Brand identity: logo, yellow/teal palette, lavender card, finance imagery | Use real `<label>`s, error text, password reveal, focus states |
| Username + password + fingerprint options | Add optional OTP/TOTP 2FA; biometrics via WebAuthn/Mantra RD service bridge |
| Forgot password entry point | Secure reset via expiring signed token, not manual admin reset |
| Bootstrap-like familiarity | Move to a design system (MUI/Tailwind) with tokens, dark mode, responsive grid |
| Server-validated form | Inline validation, lockout messaging, audit of failed logins |

### 2.3 Design tokens to start from [PROPOSED]
- Primary: deep teal (from logo swirl) `#1F7A7A`; accent: gold `#F2B705`; surface lavender `#EDE7FB`; text slate `#1F2937`.
- Typography: Karla (observed) or Inter; 14px base for dense tables.
- Layout: left collapsible sidebar (240px / 64px), top header with branch switcher, breadcrumb, user menu.

---

## 3. Business domain model [INFERRED]

Udgam Microfinance is an Indian MFI. Typical model: **joint-liability / JLG group lending** with
weekly or fortnightly/monthly collections by field staff at **center meetings**, Aadhaar/PAN KYC,
credit bureau (CIBIL/CRIF/Equifax) checks, and RBI-style rules (household income caps, FOIR,
loan-cycle ceilings, collateral-free loans).

### 3.1 End-to-end workflow

```
Branch & Employee setup
        │
Customer (Member) onboarding ──► KYC documents (Aadhaar/PAN/Voter/photo/bank/biometric)
        │                               │  verify / reject
        ▼                               ▼
Group / Center assignment  ◄───  KYC Verified
        │
Loan Application (product, amount, tenure, purpose)
        │
Field Verification (house visit, CGT/GRT, geotag, photo)
        │
Credit Review (bureau, FOIR, existing loans, cycle limit)
        │
 ┌──────┴──────┐
Approve     Reject (reason) ──► closed
 │
Sanction (sanction letter, terms, insurance, processing fee)
 │
Disbursement (cash/bank/UPI, voucher, ledger posting)
 │
Repayment Schedule generated (flat/declining, weekly/monthly)
 │
EMI Collection (center meeting, receipt, offline sync)
 │
Overdue Management (DPD buckets, follow-up, penalty, restructuring)
 │
Loan Closure (foreclosure / maturity / NOC) or Write-off
```

State machines are in §6.

---

## 4. Modules (proposed sidebar) [PROPOSED, INFERRED]

| # | Module | Sub-screens |
|---|---|---|
| 1 | Dashboard | KPI cards, charts, today's collection, PAR, alerts |
| 2 | Branches | list, create/edit, branch hierarchy (Region → Zone → Branch) |
| 3 | Employees | list, profile, role assignment, branch mapping, biometric enrollment |
| 4 | Centers | list, meeting day/time, assigned officer |
| 5 | Groups (JLG/SHG) | list, members, leader, formation, dissolve |
| 6 | Customers / Members | list, 360° profile, create wizard, family/nominee, bank |
| 7 | KYC | document upload, verify/reject queue, expiry |
| 8 | Loan Products | list, create/edit, interest, fees, eligibility |
| 9 | Loan Applications | list, new, field verification, credit review, approve/reject |
| 10 | Sanction | sanction queue, letter print |
| 11 | Disbursement | pending queue, disburse, voucher |
| 12 | Loans (Accounts) | active loans, ledger, schedule, statement |
| 13 | Collections | center-wise collection sheet, bulk entry, receipts, reconciliation |
| 14 | Overdue / Recovery | DPD buckets, follow-ups, promise-to-pay, legal |
| 15 | Transactions / Accounts | day book, cash book, vouchers, GL, bank reconciliation |
| 16 | Reports | portfolio, collection, PAR, demand-collection-balance (DCB), MIS, regulatory |
| 17 | Documents | template/print center (sanction letter, passbook, receipts) |
| 18 | Notifications | SMS/WhatsApp/email templates, logs |
| 19 | Audit Logs | immutable activity trail |
| 20 | Settings | masters (purpose, occupation, religion, bank), holidays, roles/permissions, system params |
| 21 | Profile | change password, biometric re-enroll, sessions |

---

## 5. Screen-by-screen breakdown [PROPOSED]

Format: purpose · key fields · actions · validations · role visibility.

### 5.1 Login (OBSERVED baseline)
- Fields: UserID, Password; optional fingerprint.
- Actions: Login, Scan Fingerprint, Forgot password.
- Validations: required; lock after 5 failures; CSRF token (observed); device binding for biometric.
- Add: session timeout, IP/branch restriction, last-login display.

### 5.2 Dashboard
- Cards: Active customers, Active loans, Outstanding principal, Today's demand, Today's collected, Collection efficiency %, PAR>0/30/60/90, Disbursed MTD, Pending approvals, Overdue count.
- Charts: collection trend (30d), disbursement vs target, portfolio by product, branch ranking, DPD aging.
- Filters: branch, date range, product, officer.
- Scope: Super Admin = all; Branch Manager = own branch.

### 5.3 Branch list / form
- Fields: code (unique), name, address, state, district, pincode, phone, manager, opening date, status, IFSC/bank a/c, geo.
- Actions: create, edit, deactivate (not delete), transfer staff.

### 5.4 Employee list / form
- Fields: empCode, name, mobile, email, DOB, designation, role, branch(es), reporting manager, joining date, status, username, biometric template ref, photo.
- Validations: unique username/mobile, one active role set, branch mandatory except Super Admin.

### 5.5 Center & Group
- Center: code, name, branch, officer, meeting day, time, location, frequency.
- Group: code, name, center, leader, treasurer, formation date, min/max members (e.g., 5–10), status.
- Rules: member in only one active group; group leader must be a member.

### 5.6 Customer create (wizard)
1. Personal: name, father/spouse, DOB (age 18–60 typical), gender, marital, religion/category, mobile, address, photo.
2. KYC IDs: Aadhaar (Verhoeff checksum, masked), PAN, Voter, Ration.
3. Family & household income/expense, dependents, house type.
4. Bank: account, IFSC, holder (penny drop optional).
5. Nominee.
6. Biometric capture.
- Statuses: `DRAFT → KYC_PENDING → ACTIVE → INACTIVE/BLOCKED/DECEASED`.
- Duplicate detection: Aadhaar hash, mobile, name+DOB+father.

### 5.7 KYC
- Document types, number, file(s), issue/expiry, verification status, verified by/at, remarks.
- Queue for verifier; reject requires reason.

### 5.8 Loan Product
- Fields: code, name, min/max amount, tenure options, interest rate & type (flat/reducing), frequency (weekly/fortnightly/monthly), processing fee %, insurance %, GST, penalty rule, grace days, min cycle, eligibility, active dates.

### 5.9 Loan Application
- Fields: customer/group, product, requested amount, tenure, purpose, cycle no., existing obligations, co-applicant/guarantor.
- Sub-steps: field verification (visit date, officer, geotag, photos, income assessment, recommendation), credit review (bureau score/report, FOIR, decision, approved amount).
- Statuses: `DRAFT → SUBMITTED → FIELD_VERIFIED → CREDIT_REVIEW → APPROVED | REJECTED → SANCTIONED → DISBURSED | CANCELLED`.

### 5.10 Disbursement
- Fields: loan, mode (cash/bank/UPI), account, date, deductions (fee, insurance), net amount, voucher no., disbursed by, approved by.
- Rules: only SANCTIONED; amount ≤ sanctioned; creates schedule + ledger entries atomically; maker-checker.

### 5.11 Repayment Schedule
- Rows: installment no., due date, principal, interest, total, paid, balance, status (`PENDING/PARTIAL/PAID/OVERDUE`).

### 5.12 Collection
- Center-wise sheet: member, EMI due, arrears, advance, collect amount, mode, receipt.
- Validation: amount ≤ outstanding unless advance allowed; no future-dated beyond policy; holiday-aware.
- Allocation order: penalty → interest → principal (configurable).

### 5.13 Overdue
- DPD buckets (1–30, 31–60, 61–90, 90+), PAR, follow-up log, promise-to-pay date, assign collector.

### 5.14 Transactions / Accounting
- Types: DISBURSEMENT, COLLECTION, FEE, PENALTY, ADJUSTMENT, REVERSAL, PREPAYMENT, WRITE_OFF.
- Reversal creates counter-entry, never deletes.

### 5.15 Reports
Portfolio summary, DCB, collection report (date/branch/officer), PAR/aging, disbursement register, KYC pending, loan ledger/statement, employee productivity, cash book, audit report. Export: CSV/XLSX/PDF.

### 5.16 Settings / Roles / Audit / Notifications / Profile
Standard CRUD + permission matrix editor; audit viewer with filters (user, entity, action, date).

### 5.17 Cross-cutting UI behaviour [PROPOSED]
- Tables: server-side pagination (10/25/50/100), column sort, multi-filter, saved filters, global search by customer ID/Aadhaar-last4/mobile, export.
- States: skeleton loaders, empty-state with CTA, error banner with retry, 403/404 pages.
- Modals for quick actions; full pages for wizards.
- Status badges: green Active/Paid, amber Pending/Partial, red Overdue/Rejected, grey Closed.
- Responsive: sidebar → drawer < 992px; tables → card list < 576px; sticky action bars for field use.

---

## 6. Status machines & business rules

| Entity | States | Key transitions |
|---|---|---|
| Customer | DRAFT, KYC_PENDING, ACTIVE, INACTIVE, BLOCKED, DECEASED | KYC verified → ACTIVE |
| KYCDocument | UPLOADED, VERIFIED, REJECTED, EXPIRED | verifier action |
| Group | FORMING, ACTIVE, DISSOLVED | ≥ min members |
| LoanApplication | DRAFT, SUBMITTED, FIELD_VERIFIED, CREDIT_REVIEW, APPROVED, REJECTED, SANCTIONED, DISBURSED, CANCELLED | see §3.1 |
| Loan | ACTIVE, OVERDUE, CLOSED, FORECLOSED, RESTRUCTURED, WRITTEN_OFF | schedule events |
| Installment | PENDING, PARTIAL, PAID, OVERDUE | collection posting |
| Collection | DRAFT, POSTED, REVERSED | maker-checker optional |

Key rules: loan cycle ceiling (e.g., ₹30k → ₹40k → ₹50k); max concurrent lenders (bureau); household
income cap; FOIR ≤ 50%; no disbursement without verified KYC & group membership; EMI
computation with rounding to rupee and last-installment adjustment; penalty after grace; holiday
shifting; backdated entries blocked once day is closed (**day-end/EOD close**).

---

## 7. Database entities (MongoDB/Mongoose) [PROPOSED]

All entities: `_id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `isDeleted` (soft), `branchId` where applicable.

| Entity | Important fields | Relationships |
|---|---|---|
| User | username(unique), passwordHash, roleId, branchIds[], employeeId, status, lastLoginAt, failedAttempts, lockUntil, biometricRef, mfaSecret | → Role, Employee, Branch |
| Role | name, permissions[] (`module:action`), isSystem | ← User |
| Permission | key, module, action, description | ← Role |
| Branch | code, name, address{}, managerId, region, status, openedOn | 1–N Center, Employee |
| Employee | empCode, name, mobile, designation, branchId, reportingTo, joinDate, status | → User, Branch |
| Center | code, name, branchId, officerId, meetingDay, meetingTime, status | 1–N Group |
| Group | code, name, centerId, branchId, leaderId, memberIds[], status | → Center, Customer[] |
| Customer | customerNo, name, fatherOrSpouse, dob, gender, mobile, address{}, aadhaarHash+last4, pan, photoUrl, household{income,expense}, bank{}, nominee{}, groupId, branchId, status, cycleNo | → Group, Branch, KYCDocument[] |
| KYCDocument | customerId, type, number(masked), fileUrl[], status, verifiedBy, verifiedAt, remarks, expiry | → Customer |
| LoanProduct | code, name, min/maxAmount, tenures[], interestRate, interestType, frequency, fees{}, penalty{}, graceDays, eligibility{}, status | 1–N Application |
| LoanApplication | appNo, customerId, groupId, productId, requestedAmount, tenure, purpose, fieldVerification{}, creditReview{}, status, approvedAmount, decisions[] | → Customer, Product; 1–1 Loan |
| Loan | loanNo, applicationId, customerId, productId, sanctionAmount, disbursedAmount, rate, tenure, startDate, maturityDate, outstanding{principal,interest,penalty}, dpd, status | 1–N Schedule, Repayment |
| RepaymentSchedule | loanId, installmentNo, dueDate, principalDue, interestDue, paid{}, status | → Loan |
| Repayment | receiptNo, loanId, customerId, amount, allocation{}, mode, collectedBy, collectedAt, status, reversalOf | → Loan |
| Collection (batch) | centerId, date, collectorId, total, status, repaymentIds[] | → Center |
| Transaction | txnNo, type, loanId, amount, debit/credit accounts, voucherNo, date, branchId, refId | ledger |
| Notification | channel, to, template, payload, status, sentAt | → Customer/User |
| AuditLog | actorId, action, entity, entityId, before, after, ip, userAgent, at | append-only |
| Report | name, params, generatedBy, fileUrl, at | – |
| Counter | key, seq | numbering |

Indexes: `customer.aadhaarHash` unique, `loan.loanNo`, `(branchId,status)`, `(loanId,dueDate)`, `(centerId,date)`, text index on name/mobile.

---

## 8. RBAC matrix [PROPOSED]

Legend: V view · C create · E edit · A approve · R reject · D disburse · L collect · X export · — none. "own" = own branch/assigned records.

| Module | Super Admin | Admin | Branch Mgr | Loan Officer | Field Officer | Collection Officer | Accountant | Viewer |
|---|---|---|---|---|---|---|---|---|
| Users/Roles | VCE | VC (no SA) | V own | — | — | — | — | — |
| Branches | VCE | VCE | V own | V | — | — | V | V |
| Employees | VCE | VCE | VCE own | V | — | — | V | V |
| Customers | VCE | VCE | VCE A own | VCE | VC (draft) | V | V | V |
| KYC verify | A R | A R | A R own | A R | upload | — | — | V |
| Groups/Centers | VCE | VCE | VCE own | VCE | VC | V | V | V |
| Loan Products | VCE | VCE | V | V | V | V | V | V |
| Applications | VCEAR | VCEAR | VAR own | VCE submit | V verify | — | V | V |
| Sanction | A | A | A own | — | — | — | — | V |
| Disbursement | D | D | D own (limit) | — | — | — | D (maker) | V |
| Collections | VL | VL | VL own | V | V | VCL | V | V |
| Overdue | V | V | V E own | V | V | VE | V | V |
| Transactions | V | V | V own | — | — | — | VCE | V |
| Reports | VX | VX | VX own | V own | V own | V own | VX | V |
| Audit logs | V | V | V own | — | — | — | V | — |
| Settings | VCE | VCE | — | — | — | — | — | — |

Notes: maker ≠ checker for disbursement/reversal; amount-based approval limits per role;
Viewer is read-only with PII masked.

---

## 9. REST API (Express, `/api/v1`) [PROPOSED]

Conventions: JSON, JWT access (15m) + rotating refresh (HttpOnly cookie), pagination `?page&limit&sort&q`, filters via query, ISO dates, error envelope `{code,message,details}`, idempotency key on money POSTs.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/biometric`, `/auth/refresh`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `GET /auth/me`, `POST /auth/change-password` |
| Dashboard | `GET /dashboard/summary`, `/dashboard/collection-trend`, `/dashboard/par`, `/dashboard/branch-ranking` |
| Branches | CRUD `/branches`, `PATCH /branches/:id/status` |
| Employees | CRUD `/employees`, `POST /employees/:id/biometric` |
| Users/Roles | CRUD `/users`, `/roles`, `GET /permissions`, `PUT /roles/:id/permissions` |
| Centers/Groups | CRUD `/centers`, `/groups`, `POST /groups/:id/members`, `DELETE /groups/:id/members/:cid` |
| Customers | CRUD `/customers`, `GET /customers/:id/360`, `POST /customers/check-duplicate` |
| KYC | `POST /customers/:id/kyc`, `PATCH /kyc/:id/verify`, `/kyc/:id/reject`, `GET /kyc/queue` |
| Products | CRUD `/loan-products` |
| Applications | CRUD `/applications`, `POST /:id/submit`, `/:id/field-verification`, `/:id/credit-review`, `/:id/approve`, `/:id/reject`, `/:id/sanction` |
| Disbursement | `GET /disbursements/pending`, `POST /loans/:id/disburse` |
| Loans | `GET /loans`, `/loans/:id`, `/loans/:id/schedule`, `/loans/:id/ledger`, `POST /loans/:id/foreclose`, `/restructure`, `/write-off` |
| Collections | `GET /collections/sheet?centerId&date`, `POST /collections`, `POST /collections/:id/reverse`, `GET /receipts/:no` |
| Overdue | `GET /overdue`, `POST /overdue/:loanId/followup`, `/promise` |
| Transactions | `GET /transactions`, `POST /vouchers`, `POST /day-end/close` |
| Reports | `GET /reports/:type` (+ `?format=csv|xlsx|pdf`) |
| Documents | `POST /uploads` (signed), `GET /documents/:id`, `GET /print/sanction/:loanId` |
| Notifications | `GET /notifications`, `PATCH /:id/read`, templates CRUD |
| Audit | `GET /audit-logs` |
| Sync (field) | `POST /sync/collections` (offline batch, idempotent) |

### Operations needing special treatment

| Need | Operations |
|---|---|
| **DB transaction (Mongo session)** | disburse (loan+schedule+ledger+app status), collection posting (repayment+installments+loan balance+ledger), reversal, foreclosure, group member moves, day-end close |
| **Maker–checker** | disbursement, reversal, write-off, restructure, product rate change |
| **Branch isolation** | every query injects `branchId ∈ user.branchIds` via middleware/Mongoose plugin; SA bypass explicit |
| **Audit trail** | all state transitions, money events, permission changes, logins, exports, PII views |
| **Validation** | Joi/Zod on all inputs; Aadhaar Verhoeff; IFSC regex; amount bounds vs product; age; duplicates |
| **Rate limiting / lockout** | auth, OTP, export |

---

## 10. Frontend requirements (React) [PROPOSED]

- Stack: React 18 + Vite, TypeScript, React Router, TanStack Query, Redux Toolkit or Zustand (auth/UI only), React Hook Form + Zod, MUI or Tailwind+shadcn, Recharts.
- Core components: `AppShell`, `Sidebar` (permission-filtered), `BranchSwitcher`, `DataTable` (server-side), `FilterBar`, `StatusBadge`, `StatCard`, `FormWizard`, `FileUploader`, `ConfirmDialog`, `PermissionGate`, `Money`/`DateText`, `EmptyState`, `ErrorBoundary`, `PrintView`.
- Guards: route-level `RequireAuth`, `RequirePermission`.
- i18n-ready (English/Hindi), INR formatting (lakh/crore).
- Field-use: PWA/offline queue for collection entry.

## 11. Backend requirements (Node/Express)

Layering: `routes → controllers → services → repositories(models)`; shared `errors`, `validators`, `middleware (auth, rbac, branchScope, audit, rateLimit)`.
Services: AuthService, RBACService, CustomerService, KYCService, LoanService (EMI engine), ScheduleService, CollectionService (allocation), OverdueService (nightly DPD job), LedgerService, ReportService, NotificationService (queue), AuditService.
Jobs (BullMQ/Agenda): nightly DPD/penalty accrual, reminders, report generation, backups.
Infra: MongoDB replica set (required for transactions), Redis, S3-compatible storage, Winston/pino logs, Helmet, CORS allow-list.

## 12. Dashboard metrics & reports

Metrics: customers, active loans, GLP/outstanding, disbursed (day/MTD/YTD), demand vs collection, collection efficiency (CE %), PAR 1/30/60/90, NPA %, write-off, new customers, pending approvals, KYC pending, cost per branch, officer productivity.
Reports: see §5.15, plus regulatory (portfolio quality, loan cycle distribution, borrower-wise exposure, bureau upload file).

## 13. Security requirements

Password: argon2/bcrypt; policy + lockout; MFA optional; refresh rotation; secure cookies; CSRF for cookie flows.
PII: Aadhaar stored hashed + last4 only (UIDAI rules), field-level encryption for PAN/bank, masked in UI/logs, encryption at rest/TLS.
Authorization: deny-by-default, server-enforced RBAC + branch scope (never client-only).
Files: type/size validation, AV scan, private bucket + signed URLs.
Ops: audit immutability, backups, secrets manager, dependency scanning, OWASP ASVS L2, IP/time-window restrictions for staff.
Compliance: RBI MFI directions, DPDP Act 2023 consent, UIDAI biometric handling (no raw template storage).

## 14. Missing / unclear (needs validation against real panel)

1. Actual sidebar, labels, and module list. 2. Role names and permission granularity in the real system.
3. Interest method (flat vs reducing), frequency, fee structure. 4. Group vs individual lending, center meetings.
5. Accounting depth (full GL vs simple cash book). 6. Bureau/eKYC/payment integrations used.
7. Biometric usage scope (login only vs customer attendance/collection). 8. Language/regional needs.
9. Report formats and print templates. 10. Existing data migration source/volume.

## 15. Recommended improvements over reference

SPA with fast UX · proper labels/accessibility · real RBAC matrix & branch isolation · maker-checker ·
immutable ledger & reversals · EOD close · offline-capable collections · audit everywhere ·
dashboards with drill-down · export queue · MFA · structured API + OpenAPI docs · automated tests & CI.

## 16. MERN implementation roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Validate analysis against authenticated panel; finalize product rules (interest, fees, cycle caps); wireframes | Signed-off spec |
| 1 | Monorepo, CI, env, Mongo replica, auth, RBAC, audit, branch scope, layout shell | Login + role-gated shell |
| 2 | Masters: branches, employees, centers, groups, products, settings | CRUD + tests |
| 3 | Customers, KYC, documents, biometric hook | Onboarding E2E |
| 4 | Applications, verification, credit review, approval, sanction | Workflow E2E |
| 5 | Disbursement, EMI engine, schedule, ledger (transactions) | Money correctness tests |
| 6 | Collections, receipts, overdue/DPD jobs, reversals | Reconciles to ledger |
| 7 | Dashboard, reports, exports, notifications | Metrics verified vs raw data |
| 8 | Hardening: security review, perf, load test, backups, UAT, data migration | Go-live checklist |
| 9 | PWA/offline field collection, bureau/eKYC integrations | Optional |

Testing: unit (EMI/allocation edge cases), API integration with in-memory Mongo replica, Playwright for workflows, role-matrix tests, seed/fixture data.

---

## Appendix A — Raw observations
- Hidden biometric inputs: `txtKey, txtStatus, txtImageInfo, txtHmac, txtCi, txtPidTs, txtFinalUserID, txtFinalPassword`.
- Scripts: `/scripts/mfs100.js`, `/scripts/ProjectScripts/Biometric/SankuBio.js`, `/scripts/ProjectScripts/Login/LoginScript.js` (only opens the fingerprint modal).
- CSS: `/Content/login.css` (mostly commented out; Bootstrap 4 styling dominates).
- Script naming (`ProjectScripts/<Module>/<Module>Script.js`) suggests per-module controllers/views server-side.
