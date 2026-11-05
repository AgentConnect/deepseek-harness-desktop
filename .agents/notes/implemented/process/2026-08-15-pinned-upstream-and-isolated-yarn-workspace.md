# Agent Note: Pinned upstream source and isolated Yarn workspace

Status: implemented

English | [中文](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.zh.md)

## Problem

DSH Desktop needs the exact official DeepSeek Harness source for review while the desktop product evolves independently. Tracking that source as ordinary files lets desktop commits rewrite upstream implementation and obscures ownership. A shared package-manager graph would also mix upstream pnpm rules with the desktop product's Yarn release.

## Decision

[`deepseek-harness/`](../../../../deepseek-harness/) is a Git submodule pinned to the official repository and exact commit recorded in [`upstream.json`](../../../../upstream.json). Desktop branches treat the submodule as read-only. An upstream update changes the gitlink and metadata in a dedicated commit.

The outer README files and assets are product-owned and preserve the established DSH Desktop landing page from `anywhere-labs/deepseek-harness-desktop`. They are not derived from the official source submodule. Package-level setup and release documentation belongs to [`dsh-plugin-desktop/README.md`](../../../../dsh-plugin-desktop/README.md); the proposed community interoperability contract belongs to [`dsh-community-fabric/README.md`](../../../../dsh-community-fabric/README.md); the proposed market product and trust boundary belongs to [`dsh-community-market/README.md`](../../../../dsh-community-market/README.md).

The outer repository is a Yarn 4 workspace using the `node_modules` linker. Its owned workspace members are [`dsh-plugin-desktop`](../../../../dsh-plugin-desktop/), [`dsh-community-fabric`](../../../../dsh-community-fabric/), and [`dsh-community-market`](../../../../dsh-community-market/). Fabric begins as a private documentation scaffold with no runtime entry, SDK, schema release, or DSH bundle until the community Draft has reviewed contracts and conformance evidence. Market also begins as a private documentation scaffold with no runtime entry or DSH bundle until the proposed shell has implementation and Loader evidence. The upstream checkout remains an independent pnpm workspace under its own [package-manager decision](../../../../deepseek-harness/.agents/notes/implemented/process/2026-06-16-pnpm-over-yarn.md). Root `upstream:*` scripts use Yarn's portable shell to enter the submodule before invoking its pinned pnpm release through Corepack.

Normal desktop builds resolve published DSH packages from the npm registry instead of linking source from the submodule. `upstream.json` records the source version and the runtime package family independently. The pinned public GitHub source and desktop runtime now both use the published `0.1.0-rc.8` family; the repository does not invent a source commit for an npm artifact that does not publish one.

`yarn check:layout` rejects a changed submodule URL, commit, working tree, package-manager boundary, owned workspace member list, or DSH runtime family. The root check runs the lightweight Fabric and Market documentation gates before the complete desktop gate. CI initializes submodules, installs the outer workspace immutably, runs the owned-package checks, and exercises the upstream command path on Windows.

## Verification

Acceptance requires `yarn check:layout`, `yarn upstream:version`, `yarn install --immutable`, and `yarn check` to pass. The Fabric and Market gates check their private manifests, bilingual hashes, and documentation links. The Loader smoke in the desktop gate activates the built desktop package through Cordis without opening an Electron window; neither community package has a Loader entry in its documentation-only phase.

## Alternatives considered

**Continue carrying upstream as editable root files.** This preserves one checkout but cannot mechanically distinguish official source from desktop-owned changes, which is the ownership failure this structure prevents.

**Vendor the upstream tree with a subtree or copied snapshot.** A copy can record provenance, but it still presents upstream files as ordinary product-owned files and makes accidental patches easy to commit.

**Add the upstream checkout to the Yarn workspace or use source links.** This couples desktop dependency resolution to an unmodified pnpm monorepo and makes product builds depend on unpublished source layout rather than the packages users install.

**Convert the upstream checkout to Yarn.** Package-manager conversion modifies official source and invalidates its lockfile and repository checks. Upstream commands therefore retain pnpm.

**Treat the npm runtime version as proof of a matching source revision.** The published package metadata does not identify such a revision. Keeping source and artifact versions explicit avoids a false provenance claim.

## Consequences

Desktop changes have three explicitly owned package trees, and the official checkout remains directly comparable with its remote commit. The outer landing page presents DSH Desktop, the desktop README owns application setup and release usage, the Fabric README owns the proposed community contract boundary, and the Market README owns the proposed market boundary. Product installs and checks are reproducible from the outer Yarn lockfile, while upstream verification continues to use its own pnpm lockfile.

Clones must initialize the submodule, and contributors maintain two intentionally separate package-manager caches. Source-pin updates and runtime-family updates require separate evidence because a public GitHub revision and a published npm family may not correspond.


## Private DSH identity candidate (2026-11-06)

The identity candidate uses `AgentConnect/dsh-harness-identity`, a private fixed-source mirror, while retaining the official repository and the original `fb2c4b9` baseline in `upstream.json.sourceCandidate`. The identity changes were developed in the independent Harness worktree and ported onto the actual Desktop `0.1.5-rc.2` baseline; the source under this repository remains an unmodified pinned checkout. This candidate is not an official upstream or npm release, and it does not change the existing repository's license or public-release history.

The matching runtime is produced by the complete official-profile build and the existing family pack/sync entrypoints. Source, 265 package digests and the private repository are recorded together. A reused version string does not claim that registry packages contain these changes. Both Desktop variants keep the same runtime family and are verified separately, beta first. No graphics launch, public upload or signing is implied by a headless candidate build.

A fresh authorized checkout needs read access to the private source repository. A public repository's default CI token must not be assumed to provide that access. Credentials belong in the execution environment, never in Git URLs, manifests or source. The private mirror has Actions disabled; dependency-update automation is separately disabled on its control branch. Existing Desktop release and variant gates still apply.

The local Linux identity candidate also vendors the matched Identity wrapper, native API2 build and shared Host plugin. `vendor/identity-candidate/20261106-local-v2/candidate.json` records the original tarball digests and source; explicit Yarn resolutions identify these as private candidate inputs. The machine credential worker explicitly selects Node mode only when its Host is Electron. These checks do not establish fresh account registration, a configured host keyring, or graphical acceptance.
