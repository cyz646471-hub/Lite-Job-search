# LJS Control Plane Design

## Direction

LJS uses a structured-data workspace language adapted from the Airtable
`DESIGN.md` reference. The interface is an operational recruitment-data tool,
not a marketing site: dense tables, quiet surfaces, explicit status, and fast
filtering take priority over decorative graphics.

## Tokens

- Canvas: `#ffffff`
- Workspace background: `#f3f6f8`
- Ink: `#132238`
- Body: `#333840`
- Muted: `#667085`
- Hairline: `#dce3ea`
- Link and focus: `#2459d3`
- Verified/success: `#17845b`
- Review/warning: `#b35c00`
- Rejected/error: `#c43737`
- Radius: 8px for controls, 10px for tables, 14–16px for major panels
- Spacing: 4px base scale; 8, 12, 16, 24, and 32px are the primary steps
- Font: Inter when locally available, then Segoe UI, Microsoft YaHei, and
  system sans-serif

## Data-table rules

- Table headers remain visible while scrolling.
- Search and filters precede the table and update without a full-page reload.
- SQLite-backed data refreshes every 10 seconds.
- Status is communicated with both text and color.
- Only active A-grade, published openings under a deterministic `VERIFIED`
  official recruitment portal receive an “打开投递” link.
- Review, platform, and candidate records may expose a clearly labelled source
  link for internal inspection, never as a verified application link.
- External links open in a new tab with `noopener noreferrer`.
- Empty, loading, error, disabled, hover, and keyboard-focus states are visible.

## Responsive behavior

- Desktop tables stay information-dense and scroll within bounded panels.
- Below 850px, filter controls stack to full width and tables scroll
  horizontally.
- Interactive controls retain a practical minimum height of 40px.

## Accessibility

- Use semantic headings, tables, labels, and link text that describes the
  destination.
- Maintain visible `focus-visible` rings.
- Never rely on color alone for verification or publication status.
- Keep text contrast readable on every status surface.
