/** Same-origin browser client for launcher-owned Desktop settings operations. */

const SETTINGS_PATH = '/api/desktop/settings'
const PROFILE_CREATE_PATH = '/api/desktop/profiles/create'
const PROFILE_SELECT_PATH = '/api/desktop/profiles/select'
const PROFILE_DELETE_PATH = '/api/desktop/profiles/delete'
const MARKET_SELECT_PATH = '/api/desktop/market/select'
const TERMINAL_OPEN_PATH = '/api/desktop/terminal/open'
const AWIKI_UPDATE_CHECK_PATH = '/api/desktop/awiki/check-update'
const AWIKI_UPDATE_APPLY_PATH = '/api/desktop/awiki/apply-update'
const MAX_PROFILES = 256
const MAX_PROFILE_NAME_LENGTH = 255

/** Launcher-supported plugin market implementations. */
export type DesktopMarketProvider = 'disabled' | 'community-market' | 'dsh-market'

/** Safe profile projection returned to the renderer. */
export interface DesktopProfileView {
  readonly name: string
  readonly exists: boolean
  readonly webCapable: boolean
  readonly selectable: boolean
  readonly deletable: boolean
}

/** Market selection fixed for the running generation. */
export interface DesktopMarketView {
  readonly requested: DesktopMarketProvider
  readonly effective: DesktopMarketProvider
  readonly legacyDefaulted: boolean
}

/** Complete launcher-owned settings projection. */
export interface DesktopSettingsView {
  readonly current: string
  readonly profiles: readonly DesktopProfileView[]
  readonly market: DesktopMarketView
}

/** A persisted selection that requires a new Desktop generation. */
export interface DesktopRestartAcceptance {
  readonly accepted: true
  readonly restartRequired: boolean
}

export interface DesktopAwikiVersionsView {
  readonly pluginVersion?: string
  readonly modelProxyVersion?: string
}

export type DesktopAwikiUpdateView =
  | {
      readonly status: 'up-to-date'
      readonly current: DesktopAwikiVersionsView
      readonly target: Required<DesktopAwikiVersionsView>
      readonly policy: DesktopAwikiUpdatePolicyView
    }
  | {
      readonly status: 'available'
      readonly current: DesktopAwikiVersionsView
      readonly target: Required<DesktopAwikiVersionsView>
      readonly previewId: string
      readonly policy: DesktopAwikiUpdatePolicyView
    }

export interface DesktopAwikiUpdatePolicyView {
  readonly tenantId: string
  readonly tenantGeneration: number
  readonly policyRevision: number
}

/** Browser operations consumed by the Desktop settings section. */
export interface DesktopSettingsApi {
  read(): Promise<DesktopSettingsView>
  createProfile(name: string): Promise<DesktopSettingsView>
  selectProfile(name: string): Promise<DesktopRestartAcceptance>
  deleteProfile(name: string): Promise<DesktopSettingsView>
  selectMarket(provider: DesktopMarketProvider): Promise<DesktopRestartAcceptance>
  openTerminal(): Promise<void>
  checkAwikiUpdate(): Promise<DesktopAwikiUpdateView>
  applyAwikiUpdate(previewId: string): Promise<DesktopRestartAcceptance & { readonly restartRequired: true }>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMarketProvider(value: unknown): value is DesktopMarketProvider {
  return value === 'disabled' || value === 'community-market' || value === 'dsh-market'
}

function parseProfile(value: unknown): DesktopProfileView {
  if (!isObject(value)
    || typeof value.name !== 'string'
    || value.name.length === 0
    || value.name.length > MAX_PROFILE_NAME_LENGTH
    || typeof value.exists !== 'boolean'
    || typeof value.webCapable !== 'boolean'
    || typeof value.selectable !== 'boolean'
    || typeof value.deletable !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid profile settings response')
  }
  return Object.freeze({
    name: value.name,
    exists: value.exists,
    webCapable: value.webCapable,
    selectable: value.selectable,
    deletable: value.deletable,
  })
}

/** Validate the bounded settings projection before it reaches React state. */
export function parseDesktopSettingsView(value: unknown): DesktopSettingsView {
  if (!isObject(value)
    || typeof value.current !== 'string'
    || value.current.length === 0
    || value.current.length > MAX_PROFILE_NAME_LENGTH
    || !Array.isArray(value.profiles)
    || value.profiles.length > MAX_PROFILES
    || !isObject(value.market)
    || !isMarketProvider(value.market.requested)
    || !isMarketProvider(value.market.effective)
    || typeof value.market.legacyDefaulted !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Desktop settings response')
  }
  const profiles = value.profiles.map(parseProfile)
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) {
    throw new Error('dsh-plugin-desktop: duplicate profile in settings response')
  }
  return Object.freeze({
    current: value.current,
    profiles: Object.freeze(profiles),
    market: Object.freeze({
      requested: value.market.requested,
      effective: value.market.effective,
      legacyDefaulted: value.market.legacyDefaulted,
    }),
  })
}

/** Validate restart acknowledgement returned before the Host generation exits. */
export function parseDesktopRestartAcceptance(value: unknown): DesktopRestartAcceptance {
  if (!isObject(value) || value.accepted !== true || typeof value.restartRequired !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Desktop restart response')
  }
  return Object.freeze({ accepted: true, restartRequired: value.restartRequired })
}

/** Validate the exact acknowledgement returned by a Desktop side effect. */
export function parseDesktopActionAcceptance(value: unknown): void {
  if (!isObject(value)
    || Object.keys(value).length !== 1
    || value.accepted !== true) {
    throw new Error('dsh-plugin-desktop: invalid Desktop action response')
  }
}

function parseAwikiVersions(value: unknown, required: boolean): DesktopAwikiVersionsView {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid AWiki update response')
  const pluginVersion = value.pluginVersion
  const modelProxyVersion = value.modelProxyVersion
  if ((pluginVersion !== undefined && typeof pluginVersion !== 'string')
    || (modelProxyVersion !== undefined && typeof modelProxyVersion !== 'string')
    || (required && (typeof pluginVersion !== 'string' || typeof modelProxyVersion !== 'string'))) {
    throw new Error('dsh-plugin-desktop: invalid AWiki update response')
  }
  return Object.freeze({
    ...(typeof pluginVersion === 'string' ? { pluginVersion } : {}),
    ...(typeof modelProxyVersion === 'string' ? { modelProxyVersion } : {}),
  })
}

/** Validate a bounded update result before it reaches the settings UI. */
export function parseDesktopAwikiUpdateView(value: unknown): DesktopAwikiUpdateView {
  if (!isObject(value)
    || (value.status !== 'up-to-date' && value.status !== 'available')
    || !isObject(value.policy)
    || typeof value.policy.tenantId !== 'string'
    || !Number.isSafeInteger(value.policy.tenantGeneration)
    || !Number.isSafeInteger(value.policy.policyRevision)) {
    throw new Error('dsh-plugin-desktop: invalid AWiki update response')
  }
  const current = parseAwikiVersions(value.current, false)
  const target = parseAwikiVersions(value.target, true) as Required<DesktopAwikiVersionsView>
  const policy = Object.freeze({
    tenantId: value.policy.tenantId,
    tenantGeneration: value.policy.tenantGeneration as number,
    policyRevision: value.policy.policyRevision as number,
  })
  if (value.status === 'available') {
    if (typeof value.previewId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.previewId)) {
      throw new Error('dsh-plugin-desktop: invalid AWiki update response')
    }
    return Object.freeze({ status: value.status, current, target, previewId: value.previewId, policy })
  }
  return Object.freeze({ status: value.status, current, target, policy })
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: Desktop settings request failed (${String(response.status)})`)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Desktop settings response was not JSON')
  }
}

function post(fetcher: FetchLike, path: string, body: object): Promise<Response> {
  return fetcher(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createDesktopSettingsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopSettingsApi {
  return Object.freeze({
    async read() {
      const response = await fetcher(SETTINGS_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseDesktopSettingsView(await readResponse(response))
    },
    async createProfile(name: string) {
      return parseDesktopSettingsView(await readResponse(await post(fetcher, PROFILE_CREATE_PATH, { name })))
    },
    async selectProfile(name: string) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, PROFILE_SELECT_PATH, { name })))
    },
    async deleteProfile(name: string) {
      return parseDesktopSettingsView(await readResponse(await post(fetcher, PROFILE_DELETE_PATH, { name })))
    },
    async selectMarket(provider: DesktopMarketProvider) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, MARKET_SELECT_PATH, { provider })))
    },
    async openTerminal() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, TERMINAL_OPEN_PATH, {})))
    },
    async checkAwikiUpdate() {
      return parseDesktopAwikiUpdateView(await readResponse(await post(fetcher, AWIKI_UPDATE_CHECK_PATH, {})))
    },
    async applyAwikiUpdate(previewId: string) {
      const acceptance = parseDesktopRestartAcceptance(
        await readResponse(await post(fetcher, AWIKI_UPDATE_APPLY_PATH, { previewId })),
      )
      if (!acceptance.restartRequired) {
        throw new Error('dsh-plugin-desktop: invalid AWiki update restart response')
      }
      return Object.freeze({ accepted: true as const, restartRequired: true as const })
    },
  })
}

export const desktopSettingsPaths = Object.freeze({
  settings: SETTINGS_PATH,
  profileCreate: PROFILE_CREATE_PATH,
  profileSelect: PROFILE_SELECT_PATH,
  profileDelete: PROFILE_DELETE_PATH,
  marketSelect: MARKET_SELECT_PATH,
  terminalOpen: TERMINAL_OPEN_PATH,
  awikiUpdateCheck: AWIKI_UPDATE_CHECK_PATH,
  awikiUpdateApply: AWIKI_UPDATE_APPLY_PATH,
})
