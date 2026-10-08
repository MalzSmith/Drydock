export type Params = Record<string, string | number>

export const keyed = (key: string, p?: Params) => '@' + key + (p ? ' ' + JSON.stringify(p) : '')

export const keyedList = (parts: string[]) => '@' + JSON.stringify(parts.filter(Boolean))

export const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))
