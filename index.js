const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const jsonRefParser = require('json-schema-ref-parser')
const ld = require('lodash')
const deasync = require('deasync')

const TYPE_NAME = 'schema'
// const shouldFakeElements = ['apiParamExample', 'apiSuccessExample']
const shouldDescribeElements = ['apiParam', 'apiSuccess']

const regExpStr = /{(.+)}(.+)/

/**
 * Load schema from various sources (.js, .json, .yaml, .yml)
 */
const safeLoadSchema = schemaPath => {
  const realPath = path.resolve(__dirname, schemaPath.trim())
  if (!fs.existsSync(realPath)) {
    throw new Error(`unable to load JSON schema - file not exists: ${realPath}`)
  }
  switch (path.extname(realPath)) {
    case '.yaml':
    case '.yml':
      return yaml.safeLoad(fs.readFileSync(realPath, 'utf8'))
    case '.json':
    case '.js':
      return require(realPath)
    default:
      throw new Error(`unable to load JSON schema - file type not supported: ${realPath}`)
  }
}

// http://apidocjs.com/#param-api-param
const createDocParameter = (name, type, sizeMin, sizeMax, allowedValues, isRequired, defaultValue, description) => {

  if (sizeMin || sizeMax) {
    type += `{${sizeMin || ''}..${sizeMax || ''}}`
  }

  if (allowedValues) {
    if (typeof allowedValues === 'string') {
      type += `="${allowedValues}"`
    } else {
      const allowedValuesArr = allowedValues.filter(value => typeof value === 'string' ? `"${value}"` : value)
      type += `="${allowedValuesArr.join(',')}"`
    }
  }

  if (defaultValue) { name += `=${JSON.stringify(defaultValue)}`}
  if (!isRequired) { name = `[${name}]`}

  return `{${type}} ${name} ${description || ''}`
}

const iterateObjectReqursive = (accumulator, obj = {}, depth = 0, requiredItems = []) => {
  for(let name in obj) {
    if (!obj.hasOwnProperty(name)) { return }

    const paddedName = ld.padStart(name, depth)
    const item = obj[name]
    switch (item.type) {
      case 'object': // https://spacetelescope.github.io/understanding-json-schema/reference/object.html
        iterateObjectReqursive(accumulator, item.properties, depth + 1, item.required)
        break
      case 'string': // https://spacetelescope.github.io/understanding-json-schema/reference/string.html
        accumulator.push(createDocParameter(
          paddedName,
          item.format || item.pattern ? `${item.type} / ${item.format || item.pattern.toString()}` : item.type,
          item.minLength,
          item.maxLength,
          item.enum,
          requiredItems.includes(name),
          item.default,
          item.title || item.description
        ))
        break
      case 'number': // https://spacetelescope.github.io/understanding-json-schema/reference/numeric.html
      case 'integer':
        const minimum = item.minimum ? (item.exclusiveMinimum ? item.minimum + 1 : item.minimum) : null
        const maximum = item.maximum ? (item.exclusiveMaximum ? item.maximum - 1 : item.maximum) : null
        accumulator.push(createDocParameter(
          paddedName,
          item.type,
          minimum,
          maximum,
          item.enum,
          requiredItems.includes(name),
          item.default,
          item.title || item.description
        ))
        break
      case 'boolean': // https://spacetelescope.github.io/understanding-json-schema/reference/boolean.html
        accumulator.push(createDocParameter(
          paddedName,
          item.type,
          null,
          null,
          null,
          requiredItems.includes(name),
          item.default,
          item.title || item.description
        ))
        break
      case 'array': // https://spacetelescope.github.io/understanding-json-schema/reference/array.html
        if (!item.items) {
          return accumulator.push(createDocParameter(
            paddedName,
            item.type,
            item.minItems,
            item.maxItems,
            null,
            requiredItems.includes(name),
            item.default,
            item.title || item.description
          ))
        }
        item.items.forEach(value => {
          iterateObjectReqursive(accumulator, value, depth + 1)
        })
        break
    }
  }
}

/**
 * Return apidoc-specific element based on json schema parameters
 */
const extractArgumentsFromSchema = sourceSchema => {
  // apidoc hook expect sync method: https://github.com/BigstickCarpet/json-schema-ref-parser/issues/14
  let schema, error, success = false
  jsonRefParser.dereference(sourceSchema, (err, data) => {
    error = err
    success = !err
    schema = data
  })
  deasync.loopWhile(() => { return !success })
  if (schema.type !== 'object' || !schema.properties) {
    throw new Error('expecting object on top of schema')
  }
  // 2do: title, description
  const items = []
  iterateObjectReqursive(items, schema.properties)
  return items
}
/**
@apiDescription text
@apiParam [(group)] [{type}] [field=defaultValue] [description]
@apiParamExample [{type}] [title]
                   example

@apiSuccess [(group)] [{type}] field [description]
@apiSuccessExample [{type}] [title]
                   example
 */
const parserSchemaElements = (elements, element) => {
  const { sourceName, content } = element
  if (shouldDescribeElements.includes(sourceName)) {
    const [, type, schemaPath ] = regExpStr.exec(content)
    if (type !== TYPE_NAME) { return }
    console.log(element)
    elements.pop()
    const schema = safeLoadSchema(schemaPath)
    const additionalItems = extractArgumentsFromSchema(schema)
    additionalItems.forEach(content => {
      const clonedElement = Object.assign({}, element)
      clonedElement.content = content
      elements.push(clonedElement)
      console.log(clonedElement)
    })

/*
{ source: '@apiParam {schema} test/fixtures/schemas/sample.json',
  name: 'apiparam',
  sourceName: 'apiParam',
  content: '{schema} test/fixtures/schemas/sample.json' }
 */
  }
}

module.exports = {
  init: app => {
    app.addHook('parser-find-elements', parserSchemaElements)
  }
}
