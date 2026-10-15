# Install hook

- cc runs only the Library entry's `postClone` / `postPull` (`npm install`). The `prepare` script in `package.json` builds `frontend/dist` as part of it.
- `NODE_ENV=production` or `npm_config_omit=dev` skips devDependencies, and the build then fails: the whole UI toolchain is in `devDependencies` by design (only `express` is a runtime dependency).
- Keep `package-lock.json`, `frontend/dist/` and `node_modules/` untracked, or Update's `git pull --ff-only` can abort on a path the hook modified.
- Dependency ranges are copied from cc's own `package.json` (see `docs/plugin-ui.md` in cc, "Dependencies"); re-read them from there rather than bumping by hand.
