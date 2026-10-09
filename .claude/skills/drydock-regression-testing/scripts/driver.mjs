import http from 'node:http'
import * as lib from './lib.mjs'

const s = {}
const AsyncFunction = (async () => {}).constructor
const port = +process.env.DD_DRIVER_PORT
if (!port) throw new Error('DD_DRIVER_PORT is not set (source your work/<runner>/env.sh first)')

http
  .createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    let out
    try {
      out = { ok: true, value: await new AsyncFunction('lib', 's', body)(lib, s) }
    } catch (e) {
      out = { ok: false, error: String(e?.stack ?? e) }
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out, null, 1))
  })
  .listen(port, '127.0.0.1', () => console.log(`driver ${lib.RUNNER} listening on 127.0.0.1:${port}`))
