# Continue automatically resumes saved submissions

Continue on the details page now checks the email and personal model code first.
If the backend authenticates an existing row, it restores that submission and
opens its reading page, or Work/Topics for a partially completed submission.
Returning attendees do not need to re-enter their name, affiliation, or invitation
code to load their saved answers. New registrations still require those fields
and server verification of the invitation code.

The automatic restore shares the existing manual restore helper and performs no
submission write. It supports normalized codes, legacy raw codes, and older bare
hashes through the existing backend authentication. No backend, hash, schema,
credential, or production submission changes are required.

Local drafts with unsent answers are preserved. A draft based on the current
sheet revision can continue saving; a conflicting or unknown revision stays on
the device rather than silently replacing either version. A form containing only
login fields does not block automatic loading. Switching between known accounts
restores the matching account's own answers instead of merging the prior user's
answers. Late responses are ignored after the credentials or page change.

Validation: all 109 tests pass with `node --test tests/*.test.cjs`, including new
integration coverage for matching current/legacy logins, partial submissions,
missing registration fields, a reloaded login form, account switching, unknown
draft revisions, and late responses. Existing tests cover incorrect credentials,
new registrations, concurrent revisions, preserved unsent answers, and 50 other
submissions remaining byte-for-byte unchanged. All write tests use the synthetic
in-memory Sheet. `git diff --check` and JavaScript syntax checks pass.

The public service-worker cache is bumped to `eai-v65`.
