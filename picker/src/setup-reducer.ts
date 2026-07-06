export type ConfigScope = "global" | "project"

export interface SetupSettings {
  privacy: { loggingEnabled: boolean }
  dispatch: {
    enabled: boolean
    batchMs: number
    pickerTimeoutMs: number
    technicalFailure: "default_model"
  }
  setup: { snoozedUntil: number }
}

export interface SetupState {
  settings: SetupSettings
  scope: ConfigScope
  projectGitignore?: { offer: boolean; addModelDispatchConfig: boolean; warning: string }
  privacyNotice: string
  validationErrors: Partial<Record<"batchMs" | "pickerTimeoutMs", string>>
  commands: Array<{ type: "cancel" | "snooze"; snoozedUntil: number }>
  now: number
}

export type SetupAction =
  | { type: "setScope"; scope: ConfigScope; projectIsGitRepo?: boolean }
  | { type: "setDispatch"; field: "enabled" | "batchMs" | "pickerTimeoutMs" | "technicalFailure"; value: boolean | number | string }
  | { type: "setPrivacyLogging"; enabled: boolean }
  | { type: "cancel" }
  | { type: "snooze" }
  | { type: "reset" }

const DAY_MS = 24 * 60 * 60 * 1000

export function defaultSetupSettings(): SetupSettings {
  return {
    privacy: { loggingEnabled: true },
    dispatch: {
      enabled: false,
      batchMs: 500,
      pickerTimeoutMs: 20000,
      technicalFailure: "default_model",
    },
    setup: { snoozedUntil: 0 },
  }
}

export function createSetupState(input: { settings?: SetupSettings; now?: number } = {}): SetupState {
  const state: SetupState = {
    settings: input.settings ?? defaultSetupSettings(),
    scope: "global",
    privacyNotice: "Privacy/logging is always written globally and cannot be enabled by project config.",
    validationErrors: {},
    commands: [],
    now: input.now ?? Date.now(),
  }
  return validateSetup(state)
}

export function applySetupAction(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "setScope":
      return {
        ...state,
        scope: action.scope,
        projectGitignore:
          action.scope === "project"
            ? {
                offer: action.projectIsGitRepo === true,
                addModelDispatchConfig: action.projectIsGitRepo === true,
                warning: action.projectIsGitRepo === true ? "Project settings can be committed if not ignored." : "Project is not a git repo; no .gitignore update needed.",
              }
            : undefined,
      }
    case "setDispatch":
      return validateSetup({
        ...state,
        settings: { ...state.settings, dispatch: { ...state.settings.dispatch, [action.field]: action.value } },
      })
    case "setPrivacyLogging":
      return { ...state, settings: { ...state.settings, privacy: { loggingEnabled: action.enabled } } }
    case "cancel":
      return finishWithSnooze(state, "cancel")
    case "snooze":
      return finishWithSnooze(state, "snooze")
    case "reset":
      return validateSetup({ ...state, settings: defaultSetupSettings() })
  }
}

export function setupSubmitDisabled(state: SetupState): boolean {
  return Object.keys(state.validationErrors).length > 0
}

function finishWithSnooze(state: SetupState, type: "cancel" | "snooze"): SetupState {
  const snoozedUntil = state.now + DAY_MS
  return {
    ...state,
    settings: {
      ...state.settings,
      dispatch: { ...state.settings.dispatch, enabled: false },
      setup: { snoozedUntil },
    },
    commands: [...state.commands, { type, snoozedUntil }],
  }
}

function validateSetup(state: SetupState): SetupState {
  const validationErrors: SetupState["validationErrors"] = {}
  if (state.settings.dispatch.batchMs <= 0) validationErrors.batchMs = "Batch window must be greater than 0 ms"
  if (state.settings.dispatch.pickerTimeoutMs <= 0) validationErrors.pickerTimeoutMs = "Picker timeout must be greater than 0 ms"
  return { ...state, validationErrors }
}
