// ts-jest AST transformer：把 ESM 专属的 import.meta.url 改写成 CJS 等价物，
// 让含入口自启动 guard 的 server/index.ts 能在 jest（CJS）下加载。
// require('url').pathToFileURL(__filename).href
const ts = require('typescript')

function importMetaUrlReplacer(context) {
  const factory = context.factory
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.name.text === 'url'
    ) {
      return factory.createPropertyAccessExpression(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createCallExpression(factory.createIdentifier('require'), undefined, [
              factory.createStringLiteral('url'),
            ]),
            factory.createIdentifier('pathToFileURL'),
          ),
          undefined,
          [factory.createIdentifier('__filename')],
        ),
        factory.createIdentifier('href'),
      )
    }
    return ts.visitEachChild(node, visit, context)
  }
  return (sourceFile) => ts.visitNode(sourceFile, visit)
}

module.exports = {
  version: 1,
  name: 'jest-esm-meta',
  factory() {
    return importMetaUrlReplacer
  },
}
