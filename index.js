module.exports = {
  init: app => {
    app.addHook('parser-find-elements', require('./src/parser-find-elements'))
  }
}
