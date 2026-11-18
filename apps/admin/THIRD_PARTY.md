# Third-party code

## History

`apps/admin` started from **satnaing/shadcn-admin** v2.2.1 (ADR-0008, MIT — `LICENSE`
retained). On 2026-11-18 the UI layer was replaced with **Ant Design 6** (ADR-0028).
All shadcn/ui components, Tailwind styles and demo code were removed.

What still originates from the upstream template (kept, so `LICENSE` stays):
the Vite + TanStack Router file-route setup, `tsconfig*`, ESLint config and
`index.html` skeleton. Business code (`src/lib/api.ts`, stores, features) is this
project's own.

## Runtime UI dependencies

| Package | License |
|---|---|
| antd, @ant-design/icons | MIT |
| recharts | MIT |

## Reference only

`~/Code/antd-admin` (outside this repository, no license file) was used as a layout
reference. **No code was copied from it**; its mock/permission-menu API model is not used.

## Build scripts

The workspace does not approve dependency install scripts except `esbuild` and
`msw`; `@parcel/watcher`'s build script is intentionally left unapproved.
