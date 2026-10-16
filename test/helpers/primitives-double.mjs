/**
 * A faithful double of the `@deepseek-ai/dsh-client-ui-primitives` surface the
 * settings page uses.
 *
 * Why a double rather than the real package: the primitives are a *client*
 * package, shipped as a bundler input. Their `lib/index.js` imports
 * `*.module.css`, `simple-icons` and `zustand/vanilla` — all satisfied by DSH's
 * browser bundler and by nothing else. Importing them in plain Node would mean
 * reconstructing the whole client dependency graph, which would test the
 * reconstruction rather than this plugin.
 *
 * What is therefore real in the render test: React itself (hooks, element
 * creation, `react-dom/server` output) and this plugin's own code. What is
 * doubled: the primitive components and `SettingsFormModel`. Every method below
 * mirrors the shipped contract, which was read from
 * `dsh-client-ui-primitives/lib/index.js` — the specs are copied verbatim, and
 * `SettingsFormModel` follows the same staging, shell and field-state rules.
 *
 * @module test/helpers/primitives-double
 */
import React from 'react'

/** A number field: copied from the shipped `settingsNumberField`. */
export function settingsNumberField(field) {
  return {
    field,
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** A text field: copied from the shipped `settingsTextField`. */
export function settingsTextField(field) {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * The staged form over one shared config form.
 *
 * Mirrors the shipped model: staged drafts win over the served value, a field's
 * `overridden` flag reports whether the user layer carries the key (presence,
 * not value), and `plan()` refuses a draft its spec cannot parse.
 */
export class SettingsFormModel {
  constructor(scope, specs, secrets = []) {
    this.scope = scope
    this.specs = new Map(specs.map((spec) => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]))
    this.staged = new Map()
    this.listeners = new Set()
    this.saving = false
    this.failed = false
    this.unsubscribe = scope.subscribe(() => this.publish())
  }

  /** Publish a projection, rebuilt whenever the scope or a draft changes. */
  bind(project) {
    this.project = project
    let snapshot = project()
    const listeners = new Set()
    this.listeners.add(() => {
      snapshot = project()
      for (const listener of listeners) listener()
    })
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }

  publish() {
    for (const listener of this.listeners) listener()
  }

  /** The section value the host serves for one field. */
  sectionValue(field) {
    return this.scope.getSnapshot().value?.[field]
  }

  /** Whether the user layer currently carries the key. */
  stored(field) {
    return Object.hasOwn(this.scope.getSnapshot().user ?? {}, field)
  }

  /** The inherited value below the user layer. */
  baseValue(field) {
    return this.scope.getSnapshot().base?.[field]
  }

  /** The form-level state every control shares. */
  shell() {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.run === undefined && item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** One control's state. */
  field(field) {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) return { text: staged?.text ?? '', overridden: false, invalid: false }
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`unknown settings field in the page: ${field}`)
    if (staged === undefined) {
      return {
        text: spec.format(this.sectionValue(field)),
        overridden: this.stored(field),
        invalid: false,
      }
    }
    const write = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /** Stage one draft. */
  stage(field, draft) {
    this.staged.set(field, draft)
    this.publish()
  }

  /** The edit, reset, save and discard actions a card's slot entry injects. */
  actions() {
    return {
      edit: (field, text) => this.stage(field, { text, clear: false }),
      resetField: (field) => {
        const spec = this.specs.get(field)
        this.stage(field, { text: spec.format(this.baseValue(field)), clear: true })
      },
      save: () => void this.save(),
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /** Every staged edit a save would write. */
  plan() {
    const plan = []
    for (const [field, draft] of this.staged) {
      const spec = this.specs.get(field)
      if (draft.clear) {
        plan.push({ op: { op: 'unset', path: [field] } })
        continue
      }
      const write = spec.parse(draft.text)
      if (write === undefined) {
        plan.push({})
        continue
      }
      plan.push(write.kind === 'clear' ? { op: { op: 'unset', path: [field] } } : { op: { op: 'set', path: [field], value: write.value } })
    }
    return plan
  }

  /** Write every staged edit through the shared config form. */
  async save() {
    const plan = this.plan()
    if (!plan.length || this.saving || !this.scope.getSnapshot().writable || plan.some((entry) => entry.op === undefined)) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const landed = await this.scope.mutate(plan.map((entry) => entry.op))
      if (landed) this.staged.clear()
      this.failed = !landed
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  dispose() {
    this.unsubscribe()
    this.listeners.clear()
  }
}

/** The form frame: the unavailable notice, the controls, and the save. */
export function SettingsForm({ state, labels, onSave, onDiscard, children }) {
  const discard = React.useRef(onDiscard)
  discard.current = onDiscard
  React.useEffect(() => () => discard.current(), [])
  if (!state.available) return React.createElement('p', { role: 'status' }, labels.unavailable)
  const blocked = !state.dirty || state.invalid || state.saving
  return React.createElement(
    'div',
    null,
    state.writable ? null : React.createElement('p', { role: 'status' }, labels.readOnly),
    children,
    state.failed ? React.createElement('p', { role: 'status' }, labels.saveFailed) : null,
    React.createElement('button', { type: 'button', disabled: blocked, onClick: onSave }, state.saving ? labels.saving : labels.save),
  )
}

/** A toggle switch. */
export function Switch({ checked, onChange, label, disabled = false }) {
  return React.createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    disabled,
    onClick: () => onChange(!checked),
  })
}

/** A button. */
export function Button({ variant, size, children, ...rest }) {
  return React.createElement('button', { type: 'button', 'data-variant': variant, 'data-size': size, ...rest }, children)
}

/** A read-only chip. */
export function Tag({ tone, children }) {
  return React.createElement('span', { 'data-tone': tone }, children)
}

/** A state dot. */
export function StateDot({ state, size }) {
  return React.createElement('span', { 'data-state': state, 'data-size': size })
}

export default {
  SettingsForm,
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  Switch,
  Button,
  Tag,
  StateDot,
}
