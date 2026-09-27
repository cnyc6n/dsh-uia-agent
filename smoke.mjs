// dsh-uia-agent smoke: module load + tool definition + apply register (no LLM)
import { uiaTool, apply, name } from './lib/index.js'

console.log('name =', name)

const tool = uiaTool()
console.log('tool name =', tool.name)
const params = tool.parameters
console.log('params type =', params?.type, '| required =', params?.required?.join(',') || '-')
const propNames = Object.keys(params?.properties || {})
console.log('param count =', propNames.length)
console.log('param names =', propNames.join(','))

const registered = []
const ctx = {
  effect: (fn) => { try { fn() } catch (e) { console.error('effect err:', e.message) } },
  tools: { register: (t) => registered.push(t.name) },
}
apply(ctx, {})
console.log('registered =', registered.join(','))

const ok = registered.includes('uia') && name === 'dsh-uia-agent'
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL')
process.exit(ok ? 0 : 1)