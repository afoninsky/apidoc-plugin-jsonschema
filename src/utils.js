const jsonRefParser = require('json-schema-ref-parser')
const deasync = require('deasync')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const ld = require('lodash')

function loadSchemaReferences(sourceSchema) { // https://github.com/BigstickCarpet/json-schema-ref-parser/issues/14
  let schema, error, success = false
  jsonRefParser.dereference(sourceSchema, (err, data) => {
    error = err
    success = true
    schema = data
  })
  deasync.loopWhile(() => { return !success })
  if (error) { throw error }
  return schema
}

// http://apidocjs.com/#param-api-param
function createDocParameter(name, type, sizeMin, sizeMax, allowedValues, isRequired, defaultValue, description) {

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


function iterateObjectReqursive(accumulator, obj = {}, depth = 0, requiredItems = []) {
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

module.exports = {

/**
 * Create new apidoc element based on previous one
 */
  cloneElement(sourceItem, content) {
    const newItem = Object.assign({}, sourceItem)
    newItem.source = `@${newItem.sourceName} ${content}`
    newItem.content = content
    return newItem
  },

  /**
   * Return apidoc-specific element based on json schema parameters
   */
  extractArgumentsFromSchema(schema) {
    const items = []
    if (schema.allOf) { // 2do: handle other types except 'object' in .allOf property
      const propertiesToMerge = schema.allOf.filter(item => item.type === 'object')
      ld.merge(schema, ...propertiesToMerge)
      delete schema.allOf
    }
    iterateObjectReqursive(items, schema.properties)
    return items
  },

  /**
   * Load schema from various sources (.js, .json, .yaml, .yml)
   */
  safeLoadSchema(schemaPath) {
    const realPath = path.resolve(process.cwd(), schemaPath.trim())
    if (!fs.existsSync(realPath)) {
      throw new Error(`unable to load JSON schema - file not exists: ${realPath}`)
    }
    let sourceSchema
    switch (path.extname(realPath)) {
      case '.yaml':
      case '.yml':
        sourceSchema = yaml.safeLoad(fs.readFileSync(realPath, 'utf8'))
        break
      case '.json':
      case '.js':
        sourceSchema = require(realPath)
        break
      default:
        throw new Error(`unable to load JSON schema - file type not supported: ${realPath}`)
    }

    // load schemas from relative to current directory, fallback to schema directory
    let schema
    try {
      schema = loadSchemaReferences(sourceSchema)
    } catch (err) {
      if (err.code !== 'ENOENT') { throw err }
      const curDir = process.cwd()
      const schemaDir = path.dirname(realPath)
      process.chdir(schemaDir)
      try {
        schema = loadSchemaReferences(sourceSchema)
      } finally  {
        process.chdir(curDir)
      }
    }
    if (schema.type !== 'object') {
      throw new Error('expecting object on top of schema')
    }
    return schema
  }

}
