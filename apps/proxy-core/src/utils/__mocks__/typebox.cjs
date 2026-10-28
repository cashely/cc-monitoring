// jest 环境下的 typebox 替身：真实包是纯 ESM（.mjs），ts-jest 的 CJS 输出无法加载。
// 所有 Type.* 调用仅用于生成工具参数 schema，测试不做 schema 校验，统一返回 {}。
module.exports = {
  Type: new Proxy({}, { get: () => () => ({}) }),
}
