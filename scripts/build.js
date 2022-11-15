const fs = require('fs').promises
const camelcase = require('camelcase')
const { promisify } = require('util')
const rimraf = promisify(require('rimraf'))
const svgr = require('@svgr/core').default
const babel = require('@babel/core')
const { compile: compileVue } = require('@vue/compiler-dom')
const { dirname } = require('path')
const { snakeCase } = require("snake-case")

let transform = {
  react: async (svg, componentName, format) => {
    let component = await svgr(svg, { ref: true, titleProp: true }, { componentName })
    let { code } = await babel.transformAsync(component, {
      plugins: [[require('@babel/plugin-transform-react-jsx'), { useBuiltIns: true }]],
    })

    if (format === 'esm') {
      return code
    }

    return code
      .replace('import * as React from "react"', 'const React = require("react")')
      .replace('export default', 'module.exports =')
  },
  vue: (svg, componentName, format) => {
    let { code } = compileVue(svg, {
      mode: 'module',
    })

    if (format === 'esm') {
      return code.replace('export function', 'export default function')
    }

    return code
      .replace(
        /import\s+\{\s*([^}]+)\s*\}\s+from\s+(['"])(.*?)\2/,
        (_match, imports, _quote, mod) => {
          let newImports = imports
            .split(',')
            .map((i) => i.trim().replace(/\s+as\s+/, ': '))
            .join(', ')

          return `const { ${newImports} } = require("${mod}")`
        }
      )
      .replace('export function render', 'module.exports = function render')
  },
  gomponents: (svg, componentName) => {
    var content = svg.replace(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">\n  `,
        `h.Mini(g.Group(children),\n\t\tg.Raw(\``)
    content = content.replace(`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">\n  `,
        `h.Outline(g.Group(children),\n\t\tg.Raw(\``)
    content = content.replace(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">\n  `,
        `h.Solid(g.Group(children),\n\t\tg.Raw(\``)
    content = content.replace(`\n</svg>\n`, `\`))`)
    return `func ${componentName.replace('Icon', '')}(children ...g.Node) g.Node {\n\treturn ${content}\n}`
  }
}

async function getIcons(style) {
  let files = await fs.readdir(`./optimized/${style}`)
  return Promise.all(
    files.map(async (file) => ({
      svg: await fs.readFile(`./optimized/${style}/${file}`, 'utf8'),
      componentName: `${camelcase(file.replace(/\.svg$/, ''), {
        pascalCase: true,
      })}Icon`,
    }))
  )
}

function exportAll(icons, format, includeExtension = true) {
  return icons
    .map(({ componentName }) => {
      let extension = includeExtension ? '.js' : ''
      if (format === 'esm') {
        return `export { default as ${componentName} } from './${componentName}${extension}'`
      }
      return `module.exports.${componentName} = require("./${componentName}${extension}")`
    })
    .join('\n')
}

async function ensureWrite(file, text) {
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
}

async function ensureWriteJson(file, json) {
  await ensureWrite(file, JSON.stringify(json, null, 2))
}

async function buildIcons(package, style, format) {
  let outDir = `./${package}/${style}`
  if (format === 'esm') {
    outDir += '/esm'
  }

  let icons = await getIcons(style)

  await Promise.all(
    icons.flatMap(async ({ componentName, svg }) => {
      let content = await transform[package](svg, componentName, format)
      let types =
        package === 'react'
          ? `import * as React from 'react';\ndeclare function ${componentName}(props: React.ComponentProps<'svg'> & { title?: string, titleId?: string }): JSX.Element;\nexport default ${componentName};\n`
          : `import type { FunctionalComponent, HTMLAttributes, VNodeProps } from 'vue';\ndeclare const ${componentName}: FunctionalComponent<HTMLAttributes & VNodeProps>;\nexport default ${componentName};\n`

      if (package === 'gomponents') {
        let goPackage
        switch (style) {
          case '24/outline':
            goPackage = 'outline'
            break
          case '24/solid':
            goPackage = 'solid'
            break
          case '20/solid':
            goPackage = 'mini'
            break
        }

        outDir = `./${package}/${goPackage}`

        content = `package ${goPackage}\n\nimport (\n\tg "github.com/maragudk/gomponents"\n\n\th "github.com/maragudk/gomponents-heroicons"\n)\n\n` + content + "\n"

        return [
          ensureWrite(`${outDir}/${snakeCase(componentName.replace('Icon', ''))}.go`, content),
        ]
      }

      return [
        ensureWrite(`${outDir}/${componentName}.js`, content),
        ...(types ? [ensureWrite(`${outDir}/${componentName}.d.ts`, types)] : []),
      ]
    })
  )

  if (package === 'gomponents') {
    return
  }

  await ensureWrite(`${outDir}/index.js`, exportAll(icons, format))

  await ensureWrite(`${outDir}/index.d.ts`, exportAll(icons, 'esm', false))
}

async function main(package) {
  const cjsPackageJson = { module: './esm/index.js', sideEffects: false }
  const esmPackageJson = { type: 'module', sideEffects: false }

  console.log(`Building ${package} package...`)

  await Promise.all([
    rimraf(`./${package}/20/solid/*`),
    rimraf(`./${package}/24/outline/*`),
    rimraf(`./${package}/24/solid/*`),
  ])

  if (package === 'gomponents') {
    await Promise.all([
      rimraf(`./${package}/solid/*`),
      rimraf(`./${package}/outline/*`),
      rimraf(`./${package}/mini/*`),
    ])

    await Promise.all([
      buildIcons(package, '20/solid', ''),
      buildIcons(package, '24/outline', ''),
      buildIcons(package, '24/solid', ''),
    ])

    return console.log(`Finished building ${package} package.`)
  }

  await Promise.all([
    buildIcons(package, '20/solid', 'cjs'),
    buildIcons(package, '20/solid', 'esm'),
    buildIcons(package, '24/outline', 'cjs'),
    buildIcons(package, '24/outline', 'esm'),
    buildIcons(package, '24/solid', 'cjs'),
    buildIcons(package, '24/solid', 'esm'),
    ensureWriteJson(`./${package}/20/solid/esm/package.json`, esmPackageJson),
    ensureWriteJson(`./${package}/20/solid/package.json`, cjsPackageJson),
    ensureWriteJson(`./${package}/24/outline/esm/package.json`, esmPackageJson),
    ensureWriteJson(`./${package}/24/outline/package.json`, cjsPackageJson),
    ensureWriteJson(`./${package}/24/solid/esm/package.json`, esmPackageJson),
    ensureWriteJson(`./${package}/24/solid/package.json`, cjsPackageJson),
  ])

  return console.log(`Finished building ${package} package.`)
}

let [package] = process.argv.slice(2)

if (!package) {
  throw new Error('Please specify a package')
}

main(package)
