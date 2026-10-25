# Source layout study

Source: October 4, 2026 church bulletin supplied by the project owner. Four pages, each 612 x 792 points (US Letter, portrait). Creator and producer metadata identify Microsoft Publisher for Microsoft 365.

## Page structure

| Page | Regions |
| --- | --- |
| 1 | Church identity/date, two-service worship order, regular service guide, volunteer/usher roster, meal assignments, pastoral schedule, events, midweek meetings |
| 2 | Fifteen numbered announcements in two columns, staff/online-offering sidebar, prayer-request QR, prayer intentions, giving statistics |
| 3 | Sermon title, scripture, question 1, large writing area |
| 4 | Continuation header, question 5, large writing area |

The supplied worksheet visibly contains questions 1 and 5 only. Do not infer missing questions or renumber without confirmation. The baptism announcement labels October 9, 2026 as Sunday; that date is Friday. Preserve source wording during migration and flag it for review.

## Measured page 1 geometry

Coordinates are points from the top-left of the PDF page.

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Worship order | 50.83 | 159.20 | 246.62 | 358.83 |
| Regular schedule | 51.27 | 569.36 | 246.17 | 169.32 |
| Volunteers | 310.76 | 159.33 | 247.56 | 98.91 |
| Meals | 310.76 | 279.20 | 247.55 | 45.68 |
| Pastoral schedule | 310.76 | 355.28 | 247.55 | 102.26 |
| Events | 310.76 | 485.11 | 247.55 | 119.95 |
| Midweek meetings | 310.76 | 649.98 | 247.56 | 90.75 |

Main columns are roughly 247 pt wide with a 13.3 pt gap. Page 2 announcement text begins at x=50.04 and x=231.05, y=80.21. Approximate text widths are 175 and 173 pt. These are initial region budgets, not universal text capacities. The prayer QR needs reserved space in the second column.

## Type and artwork

Most bulletin body text uses NanumSquare Regular/Bold/ExtraBold at about 9 pt. Sidebar text is approximately 6.96-8.52 pt. Worksheet title and scripture are 24 and 17.04 pt. Questions use KoPubWorldDotum Bold at about 12 pt. Other fonts include Calibri, Bebas Neue, Gill Sans, Batang, Malgun Gothic, and Symbol.

Each page has a full-page raster background. Many headings, borders, logos, the address footer, and some giving instructions/QR content are baked into those images. Backgrounds are roughly 150 dpi. Their original transforms include small offsets outside the page; simply stretching to a new page origin can change the alignment.

The PDF includes embedded font subsets, not complete reusable Korean fonts. Obtain full licensed font files and original artwork or the `.pub` source when available. Some extracted Korean labels are damaged even though they render correctly, so text extraction alone is insufficient.

## Fidelity contract

First reproduce the unchanged reference with the existing artwork and measured text/table positions. Then make content fields editable. Validate full Korean font coverage and line wrapping. Use a fixed Letter print canvas, and generate the export from the same template definition as the print preview.

AI should return field proposals, not arbitrary layout HTML. Measure actual rendered text in each region. When content does not fit, explain the affected region and offer a reviewed shortening or explicit layout exception. No silent truncation, unlimited shrinking, or accidental extra pages.

Current prototype previews edited content in a responsive digital layout. Its source-image/PDF view is an immutable visual reference. The calibrated editable print renderer has not been implemented.


## Implementation update: edited PDF export (v0.2)

Four-page browser-side PDF export is implemented using the source artwork and measured page regions. The preview renders those exact PDF bytes. Original embedded font subsets cover known glyphs; a bundled Hangul fallback covers additional text. Unsupported glyphs or overflow block export. Several free-text areas (roster, meals, schedules and staff) preserve section boundaries but simplify inner tables. Full font and table fidelity remains a separate calibration task. The unchanged original is still available for comparison. Generated output was visually inspected on all four pages, and nine edited fields were verified by PDF text extraction. Browser UI and mobile download behavior still require device verification.


## v0.3 fixed-area preservation

The service/meeting guide and staff directory are now retained directly from the original PDF, with zero rendered pixel difference in their regions at 2× resolution. Volunteer and midweek table headers and row labels are retained; editable values are structured cells. The previous v0.2 free-text simplification for these areas is superseded. Some dynamic typography and the meal subtable remain less exact.
