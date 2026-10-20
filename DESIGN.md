# Design rationale (compare-pn)

- Typography: system-ui/sans-serif for legibility, speed, and minimal overhead.
- Layout: table-based comparison for dense PN data; sticky first column for context.
- Color: CSS variables with light/dark via prefers-color-scheme; minimal palette.
- Interaction: click-to-copy PNs for quick use; toasts for feedback.
- Motion: minimal transitions for feedback only.
- Focus: visible focus indicators for keyboard accessibility.
