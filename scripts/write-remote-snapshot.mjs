import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'supabase', 'remote-snapshot')
const dataDir = join(outDir, 'data')
const schemaDir = join(outDir, 'schema')
const rawDir = join(outDir, '_raw')
const agentTools = join(
  process.env.USERPROFILE || '',
  '.cursor',
  'projects',
  'e-work-videos-projects-UD-revamp',
  'agent-tools',
)

mkdirSync(dataDir, { recursive: true })
mkdirSync(schemaDir, { recursive: true })

function extractJson(text) {
  if (text.trimStart().startsWith('{')) {
    const outer = JSON.parse(text)
    if (typeof outer.types === 'string') return outer
    if (typeof outer.result === 'string') text = outer.result
  }
  const marker = '\n<untrusted-data-'
  const start = text.lastIndexOf(marker)
  const from = start === -1 ? text.indexOf('<untrusted-data-') : start
  if (from !== -1) {
    const openEnd = text.indexOf('>', from)
    const close = text.indexOf('</untrusted-data-', openEnd)
    if (openEnd !== -1 && close !== -1) {
      return JSON.parse(text.slice(openEnd + 1, close).trim())
    }
  }
  const jsonIdx = text.indexOf('[')
  return JSON.parse(text.slice(jsonIdx, text.lastIndexOf(']') + 1))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function loadMaybe(path) {
  if (!existsSync(path)) return null
  return extractJson(readFileSync(path, 'utf8'))
}

const catalog = loadMaybe(join(agentTools, 'd9e0d2e3-e113-4b1c-8f60-0d1fdaf39d90.txt'))
const columns = loadMaybe(join(agentTools, 'e5602e92-82b4-475a-8db4-9919c186e5a1.txt'))
const functions = loadMaybe(join(agentTools, '97100d87-4c28-47a2-8546-2da23adc1b0c.txt'))
const grants = loadMaybe(join(agentTools, '48fa7ccb-19ed-4809-8f56-cbc931390ad0.txt'))
const typesPayload = loadMaybe(join(agentTools, '28d8e497-2c9c-41ed-9dfb-a6cfe721168f.txt'))
const cms = loadMaybe(join(rawDir, 'cms.json'))
const ops = loadMaybe(join(rawDir, 'ops.json'))

const allData = {
  ...(catalog?.[0]?.dump ?? catalog?.dump ?? {}),
  ...(cms?.[0]?.dump ?? cms?.dump ?? cms ?? {}),
  ...(ops?.[0]?.dump ?? ops?.dump ?? ops ?? {}),
}

for (const [table, rows] of Object.entries(allData)) {
  if (Array.isArray(rows)) writeJson(join(dataDir, `${table}.json`), rows)
}

if (columns) writeJson(join(schemaDir, 'columns.json'), columns)
if (functions) writeJson(join(schemaDir, 'functions.json'), functions)
if (grants) writeJson(join(schemaDir, 'grants.json'), grants)
if (typesPayload?.types) writeFileSync(join(outDir, 'database.types.ts'), typesPayload.types, 'utf8')

console.log(`Wrote ${Object.keys(allData).length} data files`)
