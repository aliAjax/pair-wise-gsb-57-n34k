/* eslint-disable */
// 用 TypeScript transpileModule 即时转译，支持 @/ 路径别名，跑业务规则验证
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = __dirname.replace(/\/scripts$/, '')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) {
    const rel = request.slice(2)
    for (const candidate of [
      path.join(root, 'src', `${rel}.ts`),
      path.join(root, 'src', rel, 'index.ts'),
    ]) {
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return originalResolve.call(this, request, parent, ...rest)
}

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

require(path.join(__dirname, 'verify-receipts-main.cjs'))
