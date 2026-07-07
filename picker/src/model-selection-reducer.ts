export interface PickerModel {
  providerID: string
  providerName: string
  modelID: string
  displayName: string
}

export interface PickerTask {
  id: string
  agentType: string
  description: string
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface PickerRow {
  id: string
  agentType: string
  description: string
  expanded: boolean
}

export interface ModelSelectionCommand {
  type: "submit" | "cancel"
}

export interface ModelSelectionSubmitParams {
  selections: Array<{ taskID: string; providerID: string; modelID: string }>
}

export interface ModelSelectionState {
  rows: PickerRow[]
  rowOrder: string[]
  models: PickerModel[]
  selections: Record<string, ModelRef>
  applyToAllModel?: ModelRef
  focus: string
  dropdown: { openFor?: string; search: string }
  validationErrors: Record<string, string>
  commands: ModelSelectionCommand[]
}

export interface ModelSelectionKeyboardEventLike {
  key: string
  targetTagName?: string
  targetIsContentEditable?: boolean
  defaultPrevented?: boolean
}

export type ModelSelectionAction =
  | { type: "selectModel"; target: string; model: ModelRef }
  | { type: "openDropdown"; target: string }
  | { type: "setSearch"; value: string }
  | { type: "validationResult"; errors: Record<string, string> }
  | { type: "key"; key: "Enter" | "Escape" | "ArrowDown" | "ArrowUp"; shift?: boolean }

export function createModelSelectionState(input: { tasks: PickerTask[]; models: PickerModel[] }): ModelSelectionState {
  return {
    rows: input.tasks.map((task) => ({
      id: task.id,
      agentType: task.agentType,
      description: task.description,
      expanded: false,
    })),
    rowOrder: ["apply-to-all", ...input.tasks.map((task) => task.id)],
    models: input.models,
    selections: {},
    focus: "apply-to-all",
    dropdown: { search: "" },
    validationErrors: {},
    commands: [],
  }
}

export function applyModelSelectionAction(state: ModelSelectionState, action: ModelSelectionAction): ModelSelectionState {
  switch (action.type) {
    case "selectModel":
      return selectModel(state, action.target, action.model)
    case "openDropdown":
      return { ...state, focus: action.target, dropdown: { openFor: action.target, search: "" } }
    case "setSearch":
      return { ...state, dropdown: { ...state.dropdown, search: action.value } }
    case "validationResult":
      return { ...state, validationErrors: action.errors }
    case "key":
      return applyKey(state, action)
  }
}

export function filteredModelGroups(state: ModelSelectionState) {
  const search = state.dropdown.search.trim().toLowerCase()
  const groups: Array<{ providerID: string; providerName: string; models: PickerModel[] }> = []

  for (const model of state.models) {
    const text = `${model.providerName} ${model.providerID} ${model.displayName} ${model.modelID}`.toLowerCase()
    if (search && !text.includes(search)) continue

    let group = groups.find((candidate) => candidate.providerID === model.providerID)
    if (!group) {
      group = { providerID: model.providerID, providerName: model.providerName, models: [] }
      groups.push(group)
    }
    group.models.push(model)
  }

  return groups
}

export function modelSelectionSubmitDisabled(state: ModelSelectionState): boolean {
  if (Object.keys(state.validationErrors).length > 0) return true
  return state.rows.some((row) => state.selections[row.id] === undefined)
}

export function buildModelSelectionSubmitParams(state: ModelSelectionState): ModelSelectionSubmitParams {
  return {
    selections: state.rows.map((row) => ({
      taskID: row.id,
      providerID: state.selections[row.id]!.providerID,
      modelID: state.selections[row.id]!.modelID,
    })),
  }
}

export function shouldSubmitModelSelectionFromKeyboard(event: ModelSelectionKeyboardEventLike, state: ModelSelectionState): boolean {
  if (event.key !== "Enter" || event.defaultPrevented || modelSelectionSubmitDisabled(state)) return false
  if (event.targetIsContentEditable) return false

  switch (event.targetTagName?.toUpperCase()) {
    case "BUTTON":
    case "INPUT":
    case "SELECT":
    case "TEXTAREA":
      return false
    default:
      return true
  }
}

function selectModel(state: ModelSelectionState, target: string, model: ModelRef): ModelSelectionState {
  if (target === "apply-to-all") {
    const selections: Record<string, ModelRef> = {}
    for (const row of state.rows) selections[row.id] = model
    return { ...state, focus: "apply-to-all", applyToAllModel: model, selections, dropdown: { search: "" } }
  }

  return {
    ...state,
    focus: target,
    selections: { ...state.selections, [target]: model },
    dropdown: { search: "" },
  }
}

function applyKey(state: ModelSelectionState, action: Extract<ModelSelectionAction, { type: "key" }>): ModelSelectionState {
  if (action.key === "Escape" && action.shift) return { ...state, dropdown: { search: "" } }
  if (action.key === "Escape") return { ...state, commands: [...state.commands, { type: "cancel" }] }
  if (action.key === "ArrowDown") return moveFocus(state, 1)
  if (action.key === "ArrowUp") return moveFocus(state, -1)

  if (action.shift) {
    return {
      ...state,
      rows: state.rows.map((row) => (row.id === state.focus ? { ...row, expanded: !row.expanded } : row)),
    }
  }

  if (state.dropdown.openFor) return state
  if (modelSelectionSubmitDisabled(state)) return { ...state, dropdown: { openFor: state.focus, search: "" } }
  return { ...state, commands: [...state.commands, { type: "submit" }] }
}

function moveFocus(state: ModelSelectionState, delta: number): ModelSelectionState {
  const index = state.rowOrder.indexOf(state.focus)
  const nextIndex = Math.min(Math.max(index + delta, 0), state.rowOrder.length - 1)
  return { ...state, focus: state.rowOrder[nextIndex] ?? state.focus }
}
