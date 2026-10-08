import { COMP_BLOCKS } from '../compose/blocks.ts'
import { formatBytes, MAX_EXPORT_BLOCKS, WARN_EXPORT_BLOCKS } from '../se/sbcWrite.ts'
import { ROT_IDENTITY } from '../compose/csg.ts'
import { ROTATABLE, actions, store, type Shape, type ShapeOp, type ShapeType } from '../state/app.ts'
import { fmt1, tr } from '../i18n.ts'
import { corners, h, kicker, replaceChildren, seg, t, tAttr, text } from './dom.ts'

const GLYPH: Record<ShapeOp, string> = { add: '∪', subtract: '−', intersect: '∩' }
const OPS = ['add', 'subtract', 'intersect'] as const

function shapeMeta(sp: Shape): string {
  const b = COMP_BLOCKS.find((x) => x.t === sp.block) ?? COMP_BLOCKS[0]
  const tube = sp.type === 'torus' ? ' · ' + tr('compose.meta.tube', { n: sp.tube }) : ''
  const turned = ROTATABLE.includes(sp.type) && sp.rot.some((v, i) => v !== ROT_IDENTITY[i]) ? ' · ' + tr('compose.meta.rotated') : ''
  return `${sp.size.join('×')} @ ${sp.pos.join(', ')}${tube}${turned}${sp.shell ? ' · ' + tr('compose.meta.wall', { n: sp.shell }) : ''}${sp.op === 'add' ? ' · ' + b.name : ''}`
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
  const opts = (key: 'op' | 'type', list: Array<[string, string]>, titles?: string[], cls = 'sm') =>
    seg<string>({
      options: list,
      value: sp[key],
      optCls: cls,
      titles,
      onChange: (v) => actions.updateShape(sp.id, { [key]: v as ShapeOp & ShapeType }),
    }).el
  const shell = seg<number>({
    options: [[0, tr('compose.solid')], [1, '1'], [2, '2'], [3, '3']],
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
    opts('op', OPS.map((op) => [op, GLYPH[op]]), OPS.map((op) => tr('compose.ops.' + op)), 'sm glyph'),
    opts('type', ['box', 'sphere', 'cylinder', 'ellipsoid'].map((ty) => [ty, tr('compose.types.' + ty)])),
    opts('type', ['torus', 'pyramid'].map((ty) => [ty, tr('compose.types.' + ty)])),
    h('div', { class: 'num-grid' }, ...numRow(tr('compose.size'), sp, 'size', 1, 160), ...numRow(tr('compose.offset'), sp, 'pos', -200, 200)),
    sp.type === 'torus'
      ? h(
          'div',
          { class: 'num-grid' },
          h('span', { class: 'muted' }, tr('compose.tube')),
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
          h('span', { class: 'muted' }, tr('compose.rotate')),
          h(
            'div',
            { class: 'btn-row4' },
            btn('X 90°', () => actions.rotateShape(sp.id, 'x'), tr('compose.turn', { axis: 'X' })),
            btn('Y 90°', () => actions.rotateShape(sp.id, 'y'), tr('compose.turn', { axis: 'Y' })),
            btn('Z 90°', () => actions.rotateShape(sp.id, 'z'), tr('compose.turn', { axis: 'Z' })),
            btn(tr('compose.reset'), () => actions.rotateShape(sp.id, null)),
          ),
        )
      : null,
    h('div', { class: 'sel-grid' }, h('span', { class: 'muted' }, tr('compose.wall')), shell, h('span', { class: 'muted' }, tr('compose.block')), select),
    h(
      'div',
      { class: 'btn-row4' },
      btn('↑', () => actions.moveShape(sp.id, -1), tr('compose.moveUp')),
      btn('↓', () => actions.moveShape(sp.id, 1), tr('compose.moveDown')),
      btn(tr('compose.dup'), () => actions.dupShape(sp.id)),
      btn(tr('compose.delete'), () => actions.deleteShape(sp.id), undefined, 'color:var(--color-accent-800)'),
    ),
  )
}

function gridOpt(key: string, m: number): HTMLElement {
  const el = h('span')
  store.watch((s) => s.locale, () => (el.textContent = tr('compose.gridOpt', { grid: tr(key), size: tr('units.meters', { m: fmt1(m) }) })))
  return el
}

export function mountComposePanel(root: HTMLElement) {
  const summary = text()
  const stack = h('div', { style: 'display:contents' })
  const add = h('div', { class: 'add-row' }, h('button', { class: 'btn btn-secondary', onClick: () => actions.addShape('box') }, t('compose.add')))
  const grid = seg<'Large' | 'Small'>({
    options: [['Large', gridOpt('units.gridLarge', 2.5)], ['Small', gridOpt('units.gridSmall', 0.5)]],
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
    t('compose.export'),
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
    tAttr(h('button', { class: 'btn btn-secondary', onClick: () => actions.exportComposition() }, t('compose.saveJson')), 'title', 'compose.saveJsonTitle'),
    tAttr(h('button', { class: 'btn btn-secondary', onClick: () => picker.click() }, t('compose.openJson')), 'title', 'compose.openJsonTitle'),
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
        h('div', { class: 'between' }, kicker(t('compose.stack')), h('span', { class: 's11 muted' }, summary.el)),
        stack,
        add,
        h('span', { class: 's12 muted' }, t('compose.help')),
      ),
      h('div', { class: 'col g8' }, kicker(t('compose.file')), fileRow),
    ),
    h(
      'div',
      { class: 'comp-bot' },
      h('div', { class: 'col g8' }, kicker(t('compose.grid')), grid.el),
      h(
        'div',
        { class: 'col g8' },
        h('div', { class: 'field' }, h('label', null, t('compose.name')), name),
        exportBtn,
        sizeLine,
        warn,
        h('span', { class: 's12 muted' }, t('compose.exportNote')),
      ),
    ),
  )
  root.append(aside)

  store.watch(
    (s) => [s.compose.shapes, s.compose.selShape, s.locale] as const,
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
              h('span', { class: 'txt' }, h('span', { class: 'ttl' }, tr('compose.title.' + sp.op, { type: tr('compose.typeNames.' + sp.type) })), h('span', { class: 'meta' }, shapeMeta(sp))),
              h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
            ),
            on ? editor(sp) : null,
          )
        }),
      )
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  )
  store.watch(
    (s) => [s.compose.shapes.length, s.composeInfo?.blockCount ?? null, s.locale] as const,
    ([n, total]) => summary.set(tr('units.shapes', { count: n }) + (total === null ? '' : ' · ' + tr('units.blocks', { count: total }))),
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  )
  store.watch(
    (s) => [s.composeInfo?.blockCount ?? 0, s.composeInfo?.sbcBytes ?? 0, s.locale] as const,
    ([n, bytes]) => {
      const sz = `~${formatBytes(bytes)}`
      const blocks = tr('units.blocks', { count: n })
      sizeInfo.set(`${blocks} · ${sz}`)
      warn.hidden = n <= WARN_EXPORT_BLOCKS
      warnText.set(tr(n > MAX_EXPORT_BLOCKS ? 'compose.warnMax' : 'compose.warnBig', { blocks, size: sz, max: MAX_EXPORT_BLOCKS }))
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
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
