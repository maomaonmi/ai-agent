# AI 生图广场 Design QA

- Source visual truth: `C:/Users/xys/AppData/Local/Temp/codex-clipboard-f4140203-6511-4873-9776-c98c00ec7efa.png`, `C:/Users/xys/AppData/Local/Temp/codex-clipboard-c30f234e-1b66-4b7b-bd44-cd1ddd2abc7e.png`
- Intended viewport/state: standalone AI image ecosystem plaza with light/dark appearance, upload flow, carousel and gallery
- Implementation: `frontend/ai-agent/src/features/picture/ImagePlazaWorkspace.tsx`
- Static checks: `npx tsc --noEmit`, scoped ESLint, and `python -m py_compile main.py` passed; image director tests passed (6/6)
- Browser interactions tested: unavailable in this environment
- Console errors checked: unavailable in this environment

## Design decisions verified statically

- Dark, high-contrast studio shell combines the reference gallery's immersion with the reference generator's control density.
- Left panel owns prompt, model routing, ratio, output count, resolution and CTA; right panel is image-first and uses a responsive masonry gallery.
- Lightbox includes download, prompt reuse (做同款), and a clearly marked next-stage reference-image action.
- The UI never fabricates image assets: empty and history states render only persisted API results.
- Light/dark surfaces now use the existing `dark` document class, so SettingsDialog changes apply without a second theme store.
- Layout is mobile-first: single-column at narrow widths, two columns from `lg`, and a responsive masonry gallery from `sm`/`2xl`.
- The desktop shell no longer uses a fixed `max-width`; it fills the available viewport after the conversation sidebar, removing the large side gutters visible at 80% zoom.
- “更多 → AI 生图” now opens a full-viewport plaza; the previous generator remains available from “开始创作/进入工作台”.
- Entry points are intentionally split: the sidebar AI 生图 button opens the generator workspace, while the composer’s “更多 → AI 生图” opens the ecosystem plaza.
- The plaza has a header ecosystem nav, a prompt-led creation hero, a five-card auto-advancing carousel (three cards on smaller screens, five on wide screens) inspired by the third reference, and a searchable/category-filtered masonry gallery.
- “上传图片” accepts PNG/JPG/WebP, validates size and file signatures on the server, and persists assets in SQLite plus `data/image-studio/uploads` so “我的发布” survives reloads.
- Every carousel/gallery card opens a responsive detail dialog with image preview, tags, copyable prompt, English prompt, negative prompt, and “立即试用”; uploaded assets invoke the configured GLM-5V/Qwen-VL analyzer and cache the result, with an explicit editable fallback when no vision key is configured.

## Blocking gap

The configured tool context does not expose an in-app browser/DevTools controller, so a runtime screenshot, responsive viewport pass, and console inspection could not be completed. Run the app locally and capture the image-studio route before sign-off.

final result: blocked
