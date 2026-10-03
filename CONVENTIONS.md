# Conventions

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Stable, demo-ready code. Protected — needs one teammate's approval. No direct pushes. |
| `beta` | Integration branch. All feature work merges here first. |
| `<type>/<short-name>` | Your working branch, made off `beta`. Example: `feat/gps-location`, `fix/map-zoom`. |

**Flow:**

1. `git checkout beta && git pull`
2. `git checkout -b feat/your-thing`
3. Commit, push, and open a PR **into `beta`**
4. When `beta` is stable, someone opens a PR from `beta` into `main`, and a teammate approves it

Keep your branch up to date with `git pull origin beta` before opening a PR.

## Commit messages

Format: `<type>: <short summary>`. Use lowercase and the imperative mood ("add", not "added"). Aim for about 72 characters or fewer.

| Type | Use for |
| --- | --- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code change that isn't a fix or a feature |
| `test` | Adding or updating tests |
| `chore` | Setup, dependencies, config |

Examples:

```
feat: add manual location input
fix: handle denied GPS permission
docs: update README setup steps
chore: install leaflet
```

## Pull requests

- **Title:** same format as commits, e.g. `feat: add GPS location`
- **Description:** fill out the PR template (what changed, why, how to test, screenshots for UI changes)
- Keep PRs small and focused on one thing
- Make sure `npm run lint` and `npm run build` pass before requesting review
- Don't merge your own PR into `main`

## Code

- **Language:** TypeScript everywhere. Avoid `any`.
- **UI:** use Mantine components instead of hand-rolled HTML/CSS where possible.
- **Files:**
  - React components: `PascalCase.tsx` (e.g. `LocationInput.tsx`)
  - Other modules: `camelCase.ts` (e.g. `distance.ts`)
  - Next.js route files keep their required names (`page.tsx`, `layout.tsx`, `route.ts`)
- **Folders:**
  - `src/app/`: routes and pages
  - `src/components/`: reusable UI components
  - `src/lib/`: non-UI logic (API clients, distance math, ranking, etc.)
- **Naming:** `camelCase` for variables and functions, `PascalCase` for components and types, `UPPER_SNAKE_CASE` for constants.
- **Secrets:** never commit API keys. Put them in `.env.local` (git-ignored) and add a placeholder to `.env.example`.
