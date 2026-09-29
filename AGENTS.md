# AGENTS.md — YTubic fork working notes

## Standing rules
- **Never push without explicit permission.** Commit locally all you want; `git push`, tag pushes, and releases need a yes first.
- **Keep code comments short.** One or two lines. No essay blocks, no retelling history in comments. Put rationale in commit messages instead.

## Fork identity (ameenalasady/YTubic, fork of NUber-dev/YTubic)
- Fork versions ahead of upstream (0.11.0 vs 0.5.1). Never take upstream version bumps; keep the fork number everywhere (`package.json`, `Cargo.toml` + lock, `tauri.conf.json`).
- URLs: updater endpoint, issue links, Lrclib UA point at the **fork**. Share links (`SHARE_BASE`) deliberately point at **upstream's** live share page. Discord invite is the fork's (`v7JGAWWWj`); never add upstream's X/Donate links.

## Divergences to preserve (do not regress on upstream ports)
- No What's New feature (files stay deleted; skip upstream whats-new code, copy, skills, CSS).
- No Premium playback gate (strip gate logic; never block streaming).
- No `thumbbar.rs` (Windows taskbar buttons don't exist here; drop thumbbar-only fields like shuffle/repeat/liked from invoke args).
- No sidebar logo/wordmark/Beta badge (slim empty header).
- Last.fm and Discord live in TS stores (`src/lib/lastfm/*`, `src/lib/store/discord.ts`), not Rust. Import from the TS paths.
- Song/video picker lives in the player menu — no `SourceToggle` anywhere (player bar, fullscreen).
- Cover click opens the cover lightbox; fullscreen has its own chip/button. Both can coexist (chip stops propagation).
- Home sections reorder via Settings home tab, not upstream's setup dialog.
- Playlist page keeps server shuffle, Suggestions section, share buttons.
- Resizable sidebar/panels via `usePanelResize` + panels store (not `layout-resize-handle`).

## Upstream sync pattern
- Port valuable commits one by one as adapted commits (combine, don't blindly take sides), skip whats-new/version/skill-only ones.
- Finish with a merge of `upstream/main` resolved to our side — content-minimal, just records ancestry so GitHub shows 0 behind. Document ports vs skips in the merge message.

## Updates (unified model)
- In-app updater (download + restart) applies ONLY to Windows NSIS, macOS dmg, Linux AppImage, dev builds.
- System installs (AUR/pacman, manual .deb/.rpm) never download: version-check still runs for notification; UI offers manager guidance instead. Detection: Rust `update_source` command (APPIMAGE env → inApp; exe outside `/usr/bin|/usr/lib|/opt|/app` → inApp; else system with manager via `pacman -Qqo` proof → aur, release files → apt/dnf, else unknown).
- AUR copy command uses the detected helper (`paru` → `yay` → `pikaur` order), fallback `yay`.
- `check()` reads `latest.json`, so a release without an updater manifest silently disables ALL update UI. Every release must ship one (see release checklist).

## Media / MPRIS (Linux)
- Exactly one player: the web session (`navigator.mediaSession` metadata + handlers on macOS AND Linux). Souvlaki init is Windows-only — Rust claiming `org.mpris.MediaPlayer2.ytubic` at startup shows as a second item even with zero pushes.
- Duplicates to recognize on the bus: souvlaki `ytubic` (lowercase, real metadata) vs WebKitGTK's automatic fallback shell `YTubic` (document title, no art). WebKit offers no switch to suppress its entry.
- Frontend/backend invoke shapes must match exactly or calls fail silently (`catch(()=>{})`): fork Rust `media_update` takes FLAT args; never send upstream's nested `now{}`.
- Debugging: `busctl --user list | grep mpris`, `get-property … Identity/Metadata/PlaybackStatus`. Dev and prod run side by side (separate bundle IDs, separate bus entries) — test media with ONE instance running.

## Rust gotchas
- `discord-rich-presence` is pinned at 0.2.5: no `StatusDisplayType`/`.name` builder methods, `new()` returns `Result`. Use the manual-JSON `status_display_type` helper pattern.
- `base64 = "0.22"` is required (cookie store). Ports that touch `Cargo.toml` tend to drop it — re-add.
- `cargo check` saying "Fresh" instantly is normal with a warm cache. If suspicious, drop a `compile_error!("PROBE")` in to prove it recompiles.

## Release checklist (v* tag → draft workflow → publish)
1. Bump versions in the 4 files; `cargo check` to resync the lock.
2. Push commits, then tag + push tag (tag push triggers the Release workflow).
3. Create the draft with `--notes-file` (never inline notes: zsh eats backticks). Ignore the bogus `untagged-*` URL `gh release create` prints — verify via `gh api .../releases`.
4. Wait for all builds + `rename-assets`; verify `latest.json` exists with right version, all platforms, signatures, renamed URLs.
5. Publish (`gh release edit --draft=false`).
6. Update manifests require BOTH: `TAURI_SIGNING_PRIVATE_KEY` secret set AND matching bundled pubkey AND `createUpdaterArtifacts: true`. All three were missing/broken before v0.11.0 at least once each.
7. **There is NO backup of the updater private key** (only the write-only repo secret). If it is ever lost, rotate keys + cut a release. Do not let it be deleted.

## AUR sidecar (~/Code/ytubic-aur, local repackaging PKGBUILD)
- Repackages the release `.deb`; `pkgver()` tracks GitHub latest, download happens in `package()`.
- Asset names are platform-obvious since v0.11.0 (`YTubic_<ver>_Linux_x86_64.deb`, was `…_amd64.deb`). Check the `rename-assets` job map on 404s.
- `pkgname=ytubic` collides with yochananmarqos's source-build AUR package — submit as `ytubic-bin` if ever published.

## Verify before calling anything done
`npx tsc --noEmit`, `pnpm test --run` (238+ tests), `pnpm lint`, `cargo check`. Media/updater behavior needs a real run on the target OS — say so when it wasn't possible.
