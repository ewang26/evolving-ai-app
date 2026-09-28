# Save and access investigation — September 28, 2026

The reported message is generated when autosave receives `bad_pin`. That response
does not establish that the stored account is damaged; damaged or missing access
keys have a separate `key_reset` response.

## Reproduced defects and fixes

- **Access checked after navigation.** Continue checked only the invitation code,
  allowing an incorrect personal code to reach Work, Topics, or Questions before
  an asynchronous save reported the failure. Continue now checks account access
  before advancing and preserves the draft on failure.
- **Credentials changed during a request.** A slow reading lookup could open the
  saved reading after the personal code changed. Legacy fallback could also send
  an old code against a newly entered email. Requests now reject stale results
  and retries when the email/code changes. A late load also cannot replace edits
  made after leaving the details page.
- **Legacy accounts could lock out after a successful read.** Every request tried
  the current code format before the legacy format, even after legacy access had
  succeeded. A burst of eight requests reproduced a temporary lockout. The app
  now remembers the successful format in memory for the current email/code.
- **Returning drafts could borrow a newer revision.** Re-entering the code after
  reload bypassed the old-revision check. The check now applies regardless of
  whether the personal code was re-entered.
- **Recovery was misleading and indirect.** A code mismatch no longer suggests
  organizer restoration. The warning offers Check email and personal code;
  successful verification saves the preserved draft and returns to its page.

## Verification and limits

`node --test tests/*.test.cjs`: 97 passed, including 13 new regression/integration
cases. Integration tests execute the real inline frontend and Apps Script source
against a synthetic in-memory Sheet and cache. They cover new, current, and
legacy accounts, loaded readings, changed topics, question saves, slow requests,
credential correction, and revision conflicts. The regressions were reproduced
before their corresponding fixes. `git diff --check` and service-worker syntax
checks passed.

The connected Google account received permission denied when reading production
Sheet metadata. No production account was inspected or reset, and these tests do
not identify which path caused the user's particular incident. The supplied
error alone is insufficient to distinguish a genuinely different code from
an earlier request/state failure. The backend source and access checks were not
weakened or changed; the fixes are in the frontend.
