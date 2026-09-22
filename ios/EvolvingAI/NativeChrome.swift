import Foundation

/// The script injected into the page before it runs.
///
/// Everything here is about removing the tells of a browser. The web app is
/// unmodified — the website and the app ship the exact same `docs/`, so there
/// is no second copy to keep in step — and this is the only layer that knows
/// it is running natively.
enum NativeChrome {

    static let script = #"""
(function () {
  "use strict";

  // WebKit otherwise restores the previous scroll offset when it reloads the
  // same document, so the app opened part-way down the page — the first
  // field's label, and the console's heading, tucked under the header. Right
  // for a browser tab, wrong for an app.
  try { history.scrollRestoration = "manual"; } catch (e) {}

  // Lets the page adapt if it ever needs to (e.g. hiding an install prompt
  // that makes no sense inside an installed app).
  document.documentElement.classList.add("native-ios");

  // Copied personal links must open on the public website from any device.
  window.EAI_PUBLIC_URL = "https://www.benchmark.com/evolving-ai/app/";

  var css = document.createElement("style");
  css.textContent = [
    /* Controls never behave like page furniture: no grey tap flash, no        */
    /* magnifier, no selection handles, no long-press callout. Prose is left   */
    /* alone, so readings, citations and questions stay selectable and         */
    /* copyable exactly as they are on the website.                            */
    '*{-webkit-tap-highlight-color:transparent}',
    'button,select,label,.chip,.rail,.top,.bar,[role="button"]{',
    '  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none}',
    'input,textarea{-webkit-user-select:text;user-select:text}',

    /* `manipulation` drops the double-tap-to-zoom gesture on controls, which  */
    /* also drops the click delay that comes with waiting for it. Pinch zoom   */
    /* on the page survives, so nobody who needs larger text loses it.         */
    'button,select,input,textarea,a[href],.chip,[role="button"]{touch-action:manipulation}'
  ].join("\n");
  document.documentElement.appendChild(css);

  function send(name, value) {
    try { window.webkit.messageHandlers[name].postMessage(value); } catch (e) {}
  }

  // A light tap on every control. Capture phase, so it fires even where the
  // app stops propagation for its own handlers.
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var hit = t.closest('button,select,a[href],.chip,[role="button"]');
    if (!hit) return;
    if (hit.disabled || hit.getAttribute("aria-disabled") === "true") return;
    send("haptic", "light");
  }, true);

  // Available to the web app if it ever wants to mark a save or a failure.
  window.nativeHaptic = function (kind) { send("haptic", String(kind || "light")); };

  // Two frames after load the first screen has painted, so the launch cover
  // can come off without ever showing a blank web view.
  window.addEventListener("load", function () {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { send("appReady", 1); });
    });
  });
})();
"""#
}
