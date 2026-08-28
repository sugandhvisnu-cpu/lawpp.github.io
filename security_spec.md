# Security Specification & Red Team Audit (TDD) for Lawpp

This document outlines the strict attribute-based access control (ABAC) and security specifications for the **Lawpp** Firestore collections, ensuring high-grade legal data privacy.

## 1. Data Invariants
1. **User Ownership**: No user can read, create, update, or delete another advocate's profile or tracked cases.
2. **CNR Rigor**: Case IDs must match a 16-character alphanumeric string representing valid CNR formats.
3. **Immutability**: Once written, the `id` (CNR) and `user_id` of a case cannot be altered.
4. **Time Invariance**: Timestamps for updates (`last_updated`) and profile creations (`created_at`) must be validated against the server timestamp.
5. **No Blind Lists**: Collection list actions must strictly require filter checks matching `resource.data.user_id == request.auth.uid`.

---

## 2. The "Dirty Dozen" Malicious Payloads
Here are 12 test payloads attempting to violate security invariants and verify that they are correctly blocked by `firestore.rules`:

### Payload 1: Profile Theft (Attempt to overwrite another user's profile)
- **Path**: `/users/stolen_uid_123`
- **Payload**: `{ "uid": "stolen_uid_123", "name": "Hacker", "email": "hack@lawpp.in", "bar_id": "D/999/2026", "created_at": "2026-07-01T00:00:00Z" }`
- **Result**: `PERMISSION_DENIED` (UID mismatch with `request.auth.uid`).

### Payload 2: Ghost Field Injection (Attempting to inject unvalidated flags into case)
- **Path**: `/cases/DLHC010023452026`
- **Payload**: `{ "id": "DLHC010023452026", "user_id": "attacker_uid", "client_name": "A", "case_title": "A vs B", "court_name": "Delhi High Court", "next_hearing_date": "2026-07-15", "case_stage": "Admission", "advocate_notes": "...", "last_updated": "2026-07-01T00:00:00Z", "isAdmin": true, "ghost_privilege": "bypass" }`
- **Result**: `PERMISSION_DENIED` (Strict schema block / `keys().size() == 9`).

### Payload 3: Case Hijacking (Attacking advocate attempting to read another's case)
- **Path**: `/cases/MHAU010012342022` (Owned by `advocate_user_A`)
- **Actor**: `advocate_user_B`
- **Operation**: `get`
- **Result**: `PERMISSION_DENIED` (`existing().user_id == request.auth.uid` fails).

### Payload 4: Invalid CNR Format Injection (Id Poisoning)
- **Path**: `/cases/VERY_LONG_INVALID_CNR_ID_THAT_EXCEEDS_16_CHARACTERS`
- **Payload**: `{ "id": "VERY_LONG_INVALID_CNR_ID_THAT_EXCEEDS_16_CHARACTERS", "user_id": "attacker_uid", ... }`
- **Result**: `PERMISSION_DENIED` (`isValidId(caseId)` check fails because length > 16 or contains invalid characters).

### Payload 5: Unauthorized Note Hijacking (Attempt to edit someone else's notes)
- **Path**: `/cases/DLHC010023452026` (Owned by `advocate_user_A`)
- **Actor**: `advocate_user_B`
- **Operation**: `update` with `{ "advocate_notes": "Leaked defense strategy" }`
- **Result**: `PERMISSION_DENIED` (`existing().user_id == request.auth.uid` fails).

### Payload 6: Mutating Case Owner (Privilege escalation)
- **Path**: `/cases/DLHC010023452026`
- **Payload**: `{ "id": "DLHC010023452026", "user_id": "different_uid", "client_name": "A", ... }`
- **Result**: `PERMISSION_DENIED` (`incoming().user_id == existing().user_id` constraint violated).

### Payload 7: Client-Side Timestamp Spoofing (Forging historical date)
- **Path**: `/cases/DLHC010023452026`
- **Payload**: `{ ..., "last_updated": "1999-01-01T00:00:00Z" }`
- **Result**: `PERMISSION_DENIED` (`incoming().last_updated == request.time` check fails).

### Payload 8: Blanket Case Scraping (Attempting to list cases without uid filter)
- **Path**: `/cases`
- **Actor**: `anonymous` or `any_authenticated_user`
- **Operation**: `list` (Querying all cases without `where("user_id", "==", uid)`)
- **Result**: `PERMISSION_DENIED` (The rule mandates `resource.data.user_id == request.auth.uid`).

### Payload 9: Empty/Malformed Field Value Injection (Denial of Wallet / Data corruption)
- **Path**: `/cases/DLHC010023452026`
- **Payload**: `{ ..., "client_name": "" }` (empty string) or extremely large notes string.
- **Result**: `PERMISSION_DENIED` (Length checks in `isValidCase()` fail).

### Payload 10: Anonymous Write (Unauthenticated client write attempt)
- **Path**: `/cases/DLHC010023452026`
- **Actor**: `unauthenticated`
- **Operation**: `create`
- **Result**: `PERMISSION_DENIED` (`request.auth != null` fails).

### Payload 11: Unverified Email Login Bypass
- **Path**: `/cases/DLHC010023452026`
- **Actor**: `auth_user_with_unverified_email`
- **Operation**: `create`
- **Result**: `PERMISSION_DENIED` (`request.auth.token.email_verified == true` fails).

### Payload 12: Terminal State Tampering (Case complete bypass)
- **Path**: `/cases/DLHC010023452026` (Pre-existing state: `case_stage = "Disposed"`)
- **Operation**: `update` to set `case_stage = "Admission"`
- **Result**: `PERMISSION_DENIED` (Updates blocked once stage is "Disposed" / terminal).

---

## 3. Test Verification Blueprint
The validation helper functions in `firestore.rules` ensure that every single payload listed above is rejected, protecting the records of legal advocates.
