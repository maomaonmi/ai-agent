# Design Report template execution contract

- Reference: `C:\Users\xys\.codex\plugins\cache\openai-curated-remote\openai-templates\0.1.1\skills\artifact-template-design-report\assets\reference.docx`
- SHA-256: `BA1E11258FF52659318A321462A5E598C7BED33CF991329EB91150788FCD1A7B`
- Reference structure: 2 portrait US Letter sections, 8.5 x 11 in, 1 in margins, Helvetica Neue visual system, cover image/title/subtitle/author block, content section with Heading 1/2 hierarchy, three-column findings table, restrained black/gray palette, footer page numbers.
- Reference render: packaged renderer unavailable because LibreOffice is not installed. The retained preview was inspected; Word COM 16.0 is available but automatic PDF export blocks in this environment. Structural audits are stored in `template-style-evidence.json`.
- Editable slots: cover image, report title, subtitle, author/date, all content paragraphs and content tables after the cover section.
- Preserve-only: page size, margins, section boundary, heading styles, title style, footer/page-number furniture, overall monochrome visual language, cover image geometry, and table visual treatment.
- Typography override: use Microsoft YaHei for East Asian glyphs while retaining the source style sizes, weights, spacing, and colors. This is necessary for reliable Chinese rendering.
- Content flow: cover; executive summary; key findings; implications and target framework; recommendations and implementation phases; appendix with file/event/acceptance maps.
- Fidelity gates: reference remains unchanged; final begins from a copy of the reference; two-section geometry remains; no placeholder text remains; headings use real styles; tables use explicit widths; final document is inspected in Word and structurally audited. If automated rasterization remains blocked, disclose that visual PNG QA was unavailable.

