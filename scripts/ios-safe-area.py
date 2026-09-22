#!/usr/bin/env python3
"""Safe-area fixes for docs/index.html.

Three edits, all keyed on env(safe-area-inset-*), so they are no-ops in any
browser where the insets are zero and change nothing about the website. They
matter only on a device with a notch or a home indicator — the native app, and
equally the site in iOS Safari.

Kept as a script because a branch switch reverts docs/index.html, and these
then have to go back on. Safe to re-run: it reports and exits if already applied.
"""
import io, sys

EDITS = [
    # The sticky header carried its safe-area offset in `top:`, with no matching
    # space in the flow, so on a device with an inset it shifted DOWN over the
    # first row of content — hiding the NAME label and the console's heading.
    ("    position:sticky;top:env(safe-area-inset-top,0px);z-index:50;",
     "    position:sticky;top:0;z-index:50;\n    padding-top:env(safe-area-inset-top,0px);"),
    # The bottom bar grows by the home-indicator inset; the body padding that
    # keeps content clear of it did not, so the last line sat behind the bar.
    ("    padding-bottom:var(--bar);",
     "    padding-bottom:calc(var(--bar) + env(safe-area-inset-bottom,0px));"),
    ("  body.nobar{padding-bottom:2rem}",
     "  body.nobar{padding-bottom:calc(2rem + env(safe-area-inset-bottom,0px))}"),
]

path = sys.argv[1] if len(sys.argv) > 1 else "docs/index.html"
s = io.open(path, encoding="utf-8").read()

if all(new in s for _, new in EDITS):
    print("safe-area fixes already applied to %s" % path)
    sys.exit(0)

for old, new in EDITS:
    if new in s:
        continue
    if s.count(old) != 1:
        sys.exit("expected exactly one %r in %s, found %d" % (old[:40], path, s.count(old)))
    s = s.replace(old, new)

io.open(path, "w", encoding="utf-8").write(s)
print("applied safe-area fixes to %s" % path)
