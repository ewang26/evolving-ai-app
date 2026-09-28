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

## Follow-up with the reported account

After the user supplied a screenshot and the tracker URL, the signed-in browser
could read the exact matching row. It contains profile/work details, with no
saved topic selections or questions. Its prefixed access hash is well formed.
A limited offline comparison with the locally retained deployment settings
matched the complete supplied code, ruling out registration of a partially
typed code for this row. No credentials or hash values are included here.

A read-only `get` through the production relay accepted the supplied credentials
and returned this row. The current Benchmark website's **Load my reading** also
accepted them and displayed **Saved to the organizers' sheet**. A before/after
comparison of the exact row's copied values was identical. No production put,
credential reset, row edit, migration, or backend deployment was performed.

The screenshot has both the old error message and the old model-field hint, so
it was running code from before `f4ae83e`. In the older code an access failure
latched `autoSaveBlocked`; Continue did not clear it when the credentials stayed
the same. `f4ae83e` verifies access on Continue and clears the block after success.
The initial cause of that earlier rejection is not established by the screenshot
or the later successful read; the current production account is accessible.

Additional offline integration tests verify that:

- Continue recovers from a prior rejection with unchanged credentials, preserves
  the unsent question and stored key, and leaves 50 other submissions byte-for-byte
  unchanged.
- Reloading an older local draft retains unsent topics and questions when the
  sheet contains only the earlier details.
- Loading current, legacy, and bare-hash submissions performs zero submission
  writes and leaves every row and key unchanged.

The status wording now distinguishes an unconfirmed latest save from the
existence of earlier saved answers. The service-worker cache is `eai-v64`.
Recovery for an existing open page is to reload the same tab, re-enter the same
access details, and use Continue; clearing site data or loading an older remote
reading would risk discarding local-only answers.

Final verification: `node --test tests/*.test.cjs` passed all 100 tests;
`git diff --check` and `node --check docs/sw.js` passed.
