import { actions, store, type Tab } from '../../state/app.ts'
import type { Renderer } from '../../render/renderer.ts'
import { h } from '../dom.ts'
import { mountExportTab } from './export.ts'
import { mountSceneTab } from './scene.ts'
import { mountSectionTab } from './section.ts'
import { mountViewTab } from './view.ts'

const TABS: Array<[Tab, string]> = [['view', 'View'], ['section', 'Section'], ['scene', 'Scene'], ['export', 'Export']]

export function mountRight(root: HTMLElement, renderer: Renderer) {
  const panes: Record<Tab, HTMLElement> = {
    view: mountViewTab(),
    section: mountSectionTab(),
    scene: mountSceneTab(),
    export: mountExportTab(renderer),
  }
  const buttons = TABS.map(([id, label]) => h('button', { class: 'tab', onClick: () => actions.setTab(id) }, label))
  root.append(h('div', { class: 'tabs', 'data-tour': 'tabs' }, ...buttons), h('div', { class: 'rbody' }, ...Object.values(panes)))
  store.watch(
    (s) => s.tab,
    (tab) => {
      TABS.forEach(([id], i) => buttons[i].classList.toggle('on', id === tab))
      for (const [id, el] of Object.entries(panes)) el.hidden = id !== tab
    },
  )
}
