# Evolving AI · App Store Connect draft

## App record

- Platform: iOS
- Name: Evolving AI
- Bundle ID: `com.benchmark.evolvingai`
- SKU: `com.benchmark.evolvingai`
- Primary language: English (U.S.)
- Seller team: Erik Wang
- App Store Connect ID: `6815026303` (Prepare for Submission as of September 27, 2026)
- Version: 1.0 (build 5 is selected on the version page; build 6 is signed and ready to upload).
- Price: Free. Release availability is set to the United States only.
- Primary category: Education
- Copyright: © 2026 Erik Wang

## Version information

**Subtitle:** Seminar prep and discussion

**Description:**

An invitation-only app for seminar attendees to review readings, save progress, and discuss topics.

**Keywords:** seminar,readings,discussion

**Support URL:** https://www.benchmark.com/evolving-ai/app/support.html

**Privacy policy URL:** https://www.benchmark.com/evolving-ai/app/privacy.html

**Marketing URL:** Omitted from the public listing.

**Screenshots:** `screenshots/iphone-6.9-introduction.jpg` (1320 × 2868) and `screenshots/ipad-13-introduction.jpg` (2064 × 2752) are captures from clean iPhone 18 Pro Max and iPad Pro 13-inch simulators running build 6. They have no attendee data or event location/date in app content and were converted to JPEG for App Store Connect. The older screenshots are still uploaded and must be replaced before submission.

## App Review information

The review contact name is Erik Wang and the organizer-provided phone number is saved in Apple's private field. A synthetic review account exists in the production Sheet; its access details are saved in Apple's private App Review fields with organizer approval. Do not put credentials in this repository or public listing. Short reviewer instructions are saved in Apple's private Notes field: enter the demo email and favorite-model answer, tap “Load my reading,” and use the synthetic discussion content. The organizer console is reached by a long press on the wordmark. Manual release and build 5 are selected pending build 6 processing. Content Rights is set to the organizer-approved declaration that the app has the necessary rights to third-party content.

## Privacy questionnaire notes

The app collects a name, email address, affiliation, topic choices, written questions, optional work details, discussion posts, reports, block choices, and debrief responses. These are tied to an attendee's submission. The organizer can see the full submission; signed-in attendees can see names, affiliations, questions, and posts in discussion. No advertising or analytics SDK is included. App Store Connect has draft answers for Name, Email Address, Other User Content, and Product Interaction, all linked to identity for app functionality and not used for tracking. The organizer directed on September 27 to leave these answers unpublished. Apple's Add for Review validation then rejected the version with: “Before you can submit this app for review, an Admin must provide information about the app’s privacy practices in the App Privacy section.” Version 1.0 remains Prepare for Submission.

## Retention task

Online access closes November 10, 2026. The organizer chose to retain attendee data in the active Google Sheet until they explicitly request removal. No automatic deletion is scheduled; the published privacy page reflects this policy. Also check any copies exported from the organizer console when removal is requested.

## September 27 verification

The 82 local tests passed, an unsigned iOS Simulator Release build succeeded, and Xcode's Run command built and launched the current project for iPhone 18 Pro without a reported build error. The Simulator window was unavailable to the computer-use surface, so this does not establish a fresh touch-driven sign-in or discussion test. No new build was uploaded; App Store Connect still selects build 5.

On September 27, fresh downloads of the public `index.html`, `privacy.html`, `support.html`, and `sw.js` matched their `docs/` source files byte for byte by SHA-256. The September 22 upload audit recorded build 5's bundled `index.html` and `privacy.html` hashes as identical to those same source hashes. The original build 5 export is no longer available locally for an independent binary recheck.

## Build 6 preparation, September 27

The event location and dates were removed from the app header, public HTML metadata, and privacy/support page headers. The November 10 closure and retention terms remain in the privacy policy. All 82 tests passed. A Release Simulator build succeeded, and the clean iPhone and iPad screens were captured from the updated app. A Release device archive was exported through Xcode with Apple Distribution signing. The exported IPA passes `codesign --verify --deep --strict`; its bundle ID is `com.benchmark.evolvingai`, team `C5Z9736LG7`, version/build `1.0/6`. Its `index.html`, `privacy.html`, `support.html`, and `sw.js` are byte-identical to `docs/`; the backend script is absent from the IPA. The website has not yet been deployed and build 6 has not yet been uploaded to App Store Connect.
