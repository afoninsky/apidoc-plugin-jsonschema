const jsf = require('json-schema-faker')

const { cloneElement, safeLoadSchema, extractArgumentsFromSchema } = require('./utils')

const TYPE_NAME = 'schema'
const shouldFakeElements = ['apiParamExample', 'apiSuccessExample', 'apiErrorExample', 'apiHeaderExample']
const shouldDescribeElements = ['apiParam', 'apiSuccess', 'apiError', 'apiHeader']

module.exports = (elements, element) => {
  const { sourceName, content, name } = element

  // add description from schema
  if (element.sourceName === 'apiDescription') {
    const elementParts = /{(.+)}(.+)/.exec(content)
    const [, type, schemaPath ] = elementParts || []
    if (type !== TYPE_NAME) { return }

    elements.pop()
    const schema = safeLoadSchema(schemaPath)
    const description = schema.description || schema.title
    if (description) {
      elements.push(cloneElement(element, description))
    }
    return
  }

  // generate paramteres based on schema
  if (shouldDescribeElements.includes(sourceName)) {
    const elementParts = /{(.+)}(.+)/.exec(content)
    const [, type, schemaPath ] = elementParts || []
    if (type !== TYPE_NAME) { return }
    elements.pop()

    const additionalParts = /\((.+)\).+{/.exec(content)
    const groupName = additionalParts && additionalParts.length && additionalParts[1]

    const schema = safeLoadSchema(schemaPath)
    extractArgumentsFromSchema(schema).forEach(content => {
      elements.push(cloneElement(element, groupName ? `(${groupName}) ${content}` : content))
    })
    return
  }

  // generate samples based on schema
  if (shouldFakeElements.includes(sourceName)) {
    const elementParts = /{(.+)}(.+)/.exec(content)
    const [, type, schemaPath ] = elementParts || []
    if (type !== TYPE_NAME) { return }
    elements.pop()

    const additionalParts = /\n([\s\S]+)/.exec(content) // http://stackoverflow.com/questions/1068280/javascript-regex-multiline-flag-doesnt-work
    const additionalData = additionalParts && additionalParts.length && additionalParts[1] || ''

    const schema = safeLoadSchema(schemaPath)
    const sample = JSON.stringify(jsf(schema), null, ' ')
    const title = schema.title || schema.description || `${name}:`
    elements.push(cloneElement(element, `{json} ${title}\n${additionalData}\n${sample}`))
    return
  }
}
