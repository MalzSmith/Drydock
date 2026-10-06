import { COMP_BLOCKS } from '../compose/blocks.ts'
import { formatBytes, MAX_EXPORT_BLOCKS, WARN_EXPORT_BLOCKS } from '../se/sbcWrite.ts'
import { ROT_IDENTITY } from '../compose/csg.ts'
import { ROTATABLE, actions, store, type Shape, type ShapeOp, type ShapeType } from '../state/app.ts'
import { corners, h, kicker, replaceChildren, seg, text } from './dom.ts'

const GLYPH: Record<ShapeOp, string> = { add: '∪', subtract: '−', intersect: '∩' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function shapeMeta(sp: Shape): string {
  const b = COMP_BLOCKS.find((x) => x.t === sp.block) ?? COMP_BLOCKS[0]
  const tube = sp.type === 'torus' ? ` · tube ${sp.tube}` : ''
  const turned = ROTATABLE.includes(sp.type) && sp.rot.some((v, i) => v !== ROT_IDENTITY[i]) ? ' · rotated' : ''
  return `${sp.size.join('×')} @ ${sp.pos.join(', ')}${tube}${turned}${sp.shell ? ` · wall ${sp.shell}` : ''}${sp.op === 'add' ? ' · ' + b.name : ''}`
}

function numRow(label: string, sp: Shape, key: 'size' | 'pos', min: number, max: number): HTMLElement[] {
  return [
    h('span', { class: 'muted' }, label),
    ...[0, 1, 2].map((i) =>
      h('input', {
        class: 'input',
        type: 'number',
        min,
        max,
        value: sp[key][i],
        onChange: (e: Event) => {
          const v = [...sp[key]] as [number, number, number]
          v[i] = +(e.target as HTMLInputElement).value || 0
          actions.updateShape(sp.id, { [key]: v })
        },
      }),
    ),
  ]
}

function editor(sp: Shape): HTMLElement {
  const opts = (key: 'op' | 'type', list: Array<[string, string]>) =>
    seg<string>({
      options: list,
      value: sp[key],
      optCls: 'sm',
      onChange: (v) => actions.updateShape(sp.id, { [key]: v as ShapeOp & ShapeType }),
    }).el
  const shell = seg<number>({
    options: [[0, 'Solid'], [1, '1'], [2, '2'], [3, '3']],
    value: sp.shell,
    optCls: 'sm',
    onChange: (v) => actions.updateShape(sp.id, { shell: v }),
  }).el
  const select = h(
    'select',
    { class: 'input', onChange: () => actions.updateShape(sp.id, { block: +select.value }) },
    ...COMP_BLOCKS.map((b) => h('option', { value: b.t, selected: b.t === sp.block }, b.name)),
  )
  select.value = String(sp.block)
  const btn = (label: string, onClick: () => void, title?: string, style?: string) =>
    h('button', { class: 'btn btn-secondary', title, style, onClick }, label)
  return h(
    'div',
    { class: 'shape-edit' },
    opts('op', [['add', '∪ Add'], ['subtract', '− Subtract'], ['intersect', '∩ Intersect']]),
    opts('type', [['box', 'Box'], ['sphere', 'Sphere'], ['cylinder', 'Cyl'], ['ellipsoid', 'Ellipsoid']]),
    opts('type', [['torus', 'Torus'], ['pyramid', 'Pyramid']]),
    h('div', { class: 'num-grid' }, ...numRow('Size', sp, 'size', 1, 160), ...numRow('Offset', sp, 'pos', -200, 200)),
    sp.type === 'torus'
      ? h(
          'div',
          { class: 'num-grid' },
          h('span', { class: 'muted' }, 'Tube'),
          h('input', {
            class: 'input',
            type: 'number',
            min: 1,
            max: 80,
            value: sp.tube,
            onChange: (e: Event) => actions.updateShape(sp.id, { tube: Math.max(1, +(e.target as HTMLInputElement).value || 1) }),
          }),
        )
      : null,
    ROTATABLE.includes(sp.type)
      ? h(
          'div',
          { class: 'sel-grid' },
          h('span', { class: 'muted' }, 'Rotate'),
          h(
            'div',
            { class: 'btn-row4' },
            btn('X 90°', () => actions.rotateShape(sp.id, 'x'), 'Turn 90° about X'),
            btn('Y 90°', () => actions.rotateShape(sp.id, 'y'), 'Turn 90° about Y'),
            btn('Z 90°', () => actions.rotateShape(sp.id, 'z'), 'Turn 90° about Z'),
            btn('Reset', () => actions.rotateShape(sp.id, null)),
          ),
        )
      : null,
    h('div', { class: 'sel-grid' }, h('span', { class: 'muted' }, 'Wall'), shell, h('span', { class: 'muted' }, 'Block'), select),
    h(
      'div',
      { class: 'btn-row4' },
      btn('↑', () => actions.moveShape(sp.id, -1), 'Move earlier'),
      btn('↓', () => actions.moveShape(sp.id, 1), 'Move later'),
      btn('Dup', () => actions.dupShape(sp.id)),
      btn('Delete', () => actions.deleteShape(sp.id), undefined, 'color:var(--color-accent-800)'),
    ),
  )
}

export function mountComposePanel(root: HTMLElement) {
  const summary = text()
  const stack = h('div', { style: 'display:contents' })
  const add = h(
    'div',
    { class: 'add-row' },
    ...(['box', 'sphere', 'cylinder', 'ellipsoid', 'torus', 'pyramid'] as ShapeType[]).map((t) =>
      h('button', { class: 'btn btn-secondary', onClick: () => actions.addShape(t) }, '+ ' + cap(t)),
    ),
  )
  const grid = seg<'Large' | 'Small'>({
    options: [['Large', 'Large grid · 2.5 m'], ['Small', 'Small grid · 0.5 m']],
    value: 'Large',
    optCls: 'grow',
    style: 'display:flex',
    onChange: (v) => actions.setCompose({ grid: v }),
  })
  const name = h('input', { class: 'input', style: 'font-size:13px', onChange: () => actions.setCompose({ name: name.value }) })
  const exportBtn = h(
    'button',
    { class: 'btn btn-primary blueprint', style: 'padding:10px;font-size:15px;border:1px solid var(--color-accent)' },
    ...corners(),
    'Export blueprint · bp.sbc',
  )
  exportBtn.addEventListener('click', () => void actions.exportBlueprint())
  const picker = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
  picker.addEventListener('change', () => {
    const f = picker.files?.[0]
    picker.value = ''
    if (f) void actions.importComposition(f)
  })
  const fileRow = h(
    'div',
    { class: 'btn-row2' },
    h('button', { class: 'btn btn-secondary', title: 'Save the shape stack as a JSON file', onClick: () => actions.exportComposition() }, 'Save JSON'),
    h('button', { class: 'btn btn-secondary', title: 'Replace the shape stack with a saved JSON file', onClick: () => picker.click() }, 'Open JSON'),
    picker,
  )
  const sizeInfo = text()
  const sizeLine = h('span', { class: 's12 muted' }, sizeInfo.el)
  const warnText = text()
  const warn = h('div', { class: 'size-warn', hidden: true }, warnText.el)

  const aside = h(
    'aside',
    { class: 'comp' },
    h(
      'div',
      { class: 'comp-top' },
      h(
        'div',
        { class: 'col g8' },
        h('div', { class: 'between' }, kicker('Shape stack'), h('span', { class: 's11 muted' }, summary.el)),
        stack,
        add,
        h('span', { class: 's12 muted' }, 'Shapes evaluate top to bottom. Sizes and offsets are in blocks; a wall value hollows the shape to that thickness.'),
      ),
      h('div', { class: 'col g8' }, kicker('Composition file'), fileRow),
    ),
    h(
      'div',
      { class: 'comp-bot' },
      h('div', { class: 'col g8' }, kicker('Grid'), grid.el),
      h(
        'div',
        { class: 'col g8' },
        h('div', { class: 'field' }, h('label', null, 'Blueprint name'), name),
        exportBtn,
        sizeLine,
        warn,
        h('span', { class: 's12 muted' }, 'Downloads bp.sbc. Put it in a folder named after the blueprint inside Blueprints\\local.'),
      ),
    ),
  )
  root.append(aside)

  store.watch(
    (s) => [s.compose.shapes, s.compose.selShape] as const,
    ([shapes, sel]) => {
      replaceChildren(
        stack,
        ...shapes.map((sp, i) => {
          const on = sp.id === sel
          return h(
            'div',
            { class: 'blueprint shape' + (on ? ' sel' : '') },
            ...(on ? corners() : []),
            h(
              'button',
              { class: 'shape-head', onClick: () => actions.selectShape(on ? null : sp.id) },
              h('span', { class: 'op' }, GLYPH[sp.op]),
              h('span', { class: 'txt' }, h('span', { class: 'ttl' }, `${cap(sp.op)} ${sp.type}`), h('span', { class: 'meta' }, shapeMeta(sp))),
              h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
            ),
            on ? editor(sp) : null,
          )
        }),
      )
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  store.watch(
    (s) => [s.compose.shapes.length, s.composeInfo?.blockCount ?? null] as const,
    ([n, total]) => summary.set(`${n} ${n === 1 ? 'shape' : 'shapes'}${total === null ? '' : ` · ${total.toLocaleString('en-US')} blocks`}`),
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  store.watch(
    (s) => [s.composeInfo?.blockCount ?? 0, s.composeInfo?.sbcBytes ?? 0] as const,
    ([n, bytes]) => {
      const sz = `~${formatBytes(bytes)}`
      sizeInfo.set(`${n.toLocaleString('en-US')} ${n === 1 ? 'block' : 'blocks'} · ${sz}`)
      warn.hidden = n <= WARN_EXPORT_BLOCKS
      warnText.set(
        n > MAX_EXPORT_BLOCKS
          ? `${n.toLocaleString('en-US')} blocks (${sz}) exceeds the ${MAX_EXPORT_BLOCKS.toLocaleString('en-US')} block export limit.`
          : `${n.toLocaleString('en-US')} blocks, ${sz}. Large blueprints are slow to load and paste in the game.`,
      )
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  )
  store.watch((s) => s.compose.grid, grid.set)
  store.watch(
    (s) => s.compose.name,
    (v) => {
      if (name.value !== v) name.value = v
    },
  )
  return aside
}
