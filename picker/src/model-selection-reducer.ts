export interface PickerModel {
  providerID: string
  providerName: string
  modelID: string
  displayName: string
  variants: string[]
}

export interface PickerTask {
  id: string
  agentType: string
  description: string
}

export interface ModelRef {
  providerID: string
  modelID: string
  variant?: string
}

export interface ModelSelectionInput {
  tasks: PickerTask[]
  models: PickerModel[]
  applyToAllModels?: PickerModel[]
  preselectedModels?: Record<string, ModelRef>
  rowOnlyModels?: Record<string, PickerModel[]>
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
  selections: Array<{ taskID: string; providerID: string; modelID: string; variant?: string }>
}

export interface ModelSelectionState {
  rows: PickerRow[]
  rowOrder: string[]
  models: PickerModel[]
  applyToAllModels: PickerModel[]
  modelsByRow: Record<string, PickerModel[]>
  selections: Record<string, ModelRef>
  applyToAllModel?: ModelRef
  focus: string
  dropdown: { openFor?: string; search: string }
  validationErrors: Record<string, string>
  commands: ModelSelectionCommand[]
}

export const APPLY_TO_ALL_TARGET = JSON.stringify(["all"])

export function taskSelectionTarget(taskID: string): string {
  return JSON.stringify(["task", taskID])
}

export interface ModelSelectionKeyboardEventLike {
  key: string
  targetTagName?: string
  targetIsContentEditable?: boolean
  defaultPrevented?: boolean
}

export type ModelSelectionAction =
  | { type: "selectModel"; target: string; model: ModelRef }
  | { type: "selectVariant"; target: string; variant: string }
  | { type: "openDropdown"; target: string }
  | { type: "setSearch"; value: string }
  | { type: "validationResult"; errors: Record<string, string> }
  | { type: "key"; key: "Enter" | "Escape" | "ArrowDown" | "ArrowUp"; shift?: boolean }

export function createModelSelectionState(input: ModelSelectionInput): ModelSelectionState {
  const modelsByRow = Object.fromEntries(
    input.tasks.map((task) => [task.id, modelsForTaskInput(input, task.id)]),
  )
  const selections: Record<string, ModelRef> = {}
  for (const task of input.tasks) {
    const preselected = input.preselectedModels?.[task.id]
    const selection = preselected
      ? normalizeModelRef(modelsByRow[task.id] ?? [], preselected, preselected.variant)
      : undefined
    if (selection) selections[task.id] = selection
  }
  const applyToAllModels = input.applyToAllModels ?? input.models

  return {
    rows: input.tasks.map((task) => ({
      id: task.id,
      agentType: task.agentType,
      description: task.description,
      expanded: false,
    })),
    rowOrder: [
      APPLY_TO_ALL_TARGET,
      ...input.tasks.map((task) => taskSelectionTarget(task.id)),
    ],
    models: input.models,
    applyToAllModels,
    modelsByRow,
    selections,
    applyToAllModel: commonApplyToAllSelection(input.tasks, selections, applyToAllModels),
    focus: APPLY_TO_ALL_TARGET,
    dropdown: { search: "" },
    validationErrors: {},
    commands: [],
  }
}

export function modelSelectionInputKey(input: ModelSelectionInput | undefined): string {
  return JSON.stringify(input ?? null)
}

export function applyModelSelectionAction(state: ModelSelectionState, action: ModelSelectionAction): ModelSelectionState {
  switch (action.type) {
    case "selectModel":
      return selectModel(state, action.target, action.model)
    case "selectVariant":
      return selectVariant(state, action.target, action.variant)
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

export function filteredModelGroups(state: ModelSelectionState, target?: string) {
  const search = state.dropdown.search.trim().toLowerCase()
  const groups: Array<{ providerID: string; providerName: string; models: PickerModel[] }> = []
  const models = target ? modelsForSelectionTarget(state, target) : state.models

  for (const model of models) {
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
  return state.rows.some((row) => !selectionIsValid(
    state.modelsByRow[row.id] ?? [],
    state.selections[row.id],
  ))
}

export function buildModelSelectionSubmitParams(state: ModelSelectionState): ModelSelectionSubmitParams {
  if (modelSelectionSubmitDisabled(state)) {
    throw new Error("Cannot submit model selection while one or more rows are invalid")
  }

  return {
    selections: state.rows.map((row) => {
      const selection = state.selections[row.id]!
      return {
        taskID: row.id,
        providerID: selection.providerID,
        modelID: selection.modelID,
        ...(selection.variant ? { variant: selection.variant } : {}),
      }
    }),
  }
}

export function variantsForModel(models: PickerModel[], model: ModelRef | undefined): string[] {
  if (!model) return []
  return models.find(
    (candidate) => candidate.providerID === model.providerID && candidate.modelID === model.modelID,
  )?.variants ?? []
}

export function modelsForTaskInput(input: ModelSelectionInput, taskID: string): PickerModel[] {
  const rowOnlyModels = input.rowOnlyModels?.[taskID] ?? []
  const rowOnlyByKey = new Map(rowOnlyModels.map((model) => [modelKey(model), model]))
  const models = input.models.map((model) => rowOnlyByKey.get(modelKey(model)) ?? model)
  const keys = new Set(input.models.map(modelKey))
  for (const model of rowOnlyModels) {
    if (keys.has(modelKey(model))) continue
    keys.add(modelKey(model))
    models.push(model)
  }
  return models
}

export function modelsForSelectionTarget(state: ModelSelectionState, target: string): PickerModel[] {
  if (target === APPLY_TO_ALL_TARGET) return state.applyToAllModels
  const taskID = taskIDForSelectionTarget(target)
  return taskID ? state.modelsByRow[taskID] ?? [] : []
}

export function selectionForTarget(state: ModelSelectionState, target: string): ModelRef | undefined {
  if (target === APPLY_TO_ALL_TARGET) return state.applyToAllModel
  const taskID = taskIDForSelectionTarget(target)
  return taskID ? state.selections[taskID] : undefined
}

export function modelRefValue(model: ModelRef | undefined): string {
  return model ? JSON.stringify([model.providerID, model.modelID]) : ""
}

export function modelRefForValue(
  state: ModelSelectionState,
  target: string,
  value: string,
): ModelRef | undefined {
  const model = modelsForSelectionTarget(state, target)
    .find((candidate) => modelRefValue(candidate) === value)
  return model ? { providerID: model.providerID, modelID: model.modelID } : undefined
}

export function variantsForSelectionTarget(state: ModelSelectionState, target: string): string[] {
  return variantsForModel(modelsForSelectionTarget(state, target), selectionForTarget(state, target))
}

export function normalizeModelRef(
  models: PickerModel[],
  model: ModelRef,
  variant: string | undefined,
): ModelRef | undefined {
  const knownModel = models.find(
    (candidate) => candidate.providerID === model.providerID && candidate.modelID === model.modelID,
  )
  if (!knownModel) return undefined

  const base = { providerID: model.providerID, modelID: model.modelID }
  return variant && knownModel.variants.includes(variant)
    ? { ...base, variant }
    : base
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
  if (target === APPLY_TO_ALL_TARGET) {
    const variant = variantForModelSelection(state.applyToAllModel, model)
    const applyToAllModel = normalizeModelRef(state.applyToAllModels, model, variant)
    const selections: Record<string, ModelRef> = {}
    if (applyToAllModel) {
      for (const row of state.rows) {
        const rowVariant = variantForModelSelection(state.selections[row.id], model)
        const selection = normalizeModelRef(state.modelsByRow[row.id] ?? [], model, rowVariant)
        if (selection) selections[row.id] = selection
      }
    }
    return {
      ...state,
      focus: APPLY_TO_ALL_TARGET,
      applyToAllModel,
      selections,
      dropdown: { search: "" },
    }
  }

  const taskID = taskIDForSelectionTarget(target)
  if (!taskID || !state.modelsByRow[taskID]) return state
  const variant = variantForModelSelection(state.selections[taskID], model)
  const selection = normalizeModelRef(state.modelsByRow[taskID], model, variant)
  const selections = { ...state.selections }
  if (selection) selections[taskID] = selection
  else delete selections[taskID]
  return {
    ...state,
    focus: target,
    selections,
    dropdown: { search: "" },
  }
}

function variantForModelSelection(
  previous: ModelRef | undefined,
  next: ModelRef,
): string | undefined {
  if (next.variant !== undefined) return next.variant
  return sameModel(next, previous) ? previous?.variant : undefined
}

function selectVariant(state: ModelSelectionState, target: string, variant: string): ModelSelectionState {
  if (target === APPLY_TO_ALL_TARGET) {
    const applyToAllModel = state.applyToAllModel
      ? normalizeModelRef(state.applyToAllModels, state.applyToAllModel, variant)
      : undefined
    const selections: Record<string, ModelRef> = {}
    for (const row of state.rows) {
      const model = state.selections[row.id]
      if (!model) continue
      const selection = normalizeModelRef(state.modelsByRow[row.id] ?? [], model, variant)
      if (selection) selections[row.id] = selection
    }
    return { ...state, applyToAllModel, selections }
  }

  const taskID = taskIDForSelectionTarget(target)
  if (!taskID) return state
  const model = state.selections[taskID]
  const models = state.modelsByRow[taskID]
  if (!model || !models) return state
  const selection = normalizeModelRef(models, model, variant)
  if (!selection) return state
  return {
    ...state,
    selections: {
      ...state.selections,
      [taskID]: selection,
    },
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
      rows: state.rows.map((row) =>
        taskSelectionTarget(row.id) === state.focus
          ? { ...row, expanded: !row.expanded }
          : row
      ),
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

function commonApplyToAllSelection(
  tasks: PickerTask[],
  selections: Record<string, ModelRef>,
  applyToAllModels: PickerModel[],
): ModelRef | undefined {
  if (tasks.length === 0) return undefined
  const first = selections[tasks[0]!.id]
  if (!first) return undefined
  if (!tasks.every((task) => sameModel(first, selections[task.id]))) return undefined

  const variants = tasks.map((task) => selections[task.id]?.variant)
  const sharedVariant = new Set(variants).size === 1 ? variants[0] : undefined
  return normalizeModelRef(applyToAllModels, first, sharedVariant)
}

function selectionIsValid(models: PickerModel[], selection: ModelRef | undefined): boolean {
  if (!selection) return false
  const model = models.find((candidate) => sameModel(candidate, selection))
  if (!model) return false
  return selection.variant === undefined || model.variants.includes(selection.variant)
}

function sameModel(
  left: { providerID: string; modelID: string },
  right: { providerID: string; modelID: string } | undefined,
): boolean {
  return (
    right !== undefined &&
    left.providerID === right.providerID &&
    left.modelID === right.modelID
  )
}

function modelKey(model: { providerID: string; modelID: string }): string {
  return JSON.stringify([model.providerID, model.modelID])
}

function taskIDForSelectionTarget(target: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(target)
    return (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed[0] === "task" &&
      typeof parsed[1] === "string"
    )
      ? parsed[1]
      : undefined
  } catch {
    return undefined
  }
}
