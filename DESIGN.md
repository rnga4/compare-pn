# Design rationale (compare-pn)

- Typography: system-ui/sans-serif for legibility, fast rendering without web-font layout shift, and optimal readability for dense part numbers.
- Layout: table-based comparison for dense PN data; sticky first column (`Barang`) and sticky table headers (`thead th`) with prioritized z-index hierarchy (`th:first-child` at z-index 160) to keep context clear during diagonal scrolls.
- Color: CSS variables with complete palette coverage (light, dark, sakura, bamboo, cyberpunk, mingyu, ocean, retrolight) satisfying WCAG AA contrast standards.
- Topbar Glassmorphism: frosted translucent header allows continuous table visibility underneath while keeping primary search controls anchored.
- Interaction: click-to-copy PNs for fast clipboard operations; non-intrusive toast stack for confirmation; properly targeted scroll-to-top button.
- Mobile layout: responsive tap targets (min 44px), independent bottom positioning for `#topBtn` and `#bAdd` to prevent control overlap on small screens.
- Motion: targeted micro-transitions on interactive controls only (.btn, nav links, inputs), omitting wildcard transitions to maintain 60fps scrolling on large data tables.
- Focus: visible focus indicators (:focus-visible) across all buttons, inputs, and links for keyboard accessibility.
