/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        ignoreCodes: [6137, 1343]
      }
    }],
    '^.+\\.jsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        ignoreCodes: [6137, 1343]
      }
    }]
  },
  transformIgnorePatterns: [
    '/node_modules/.pnpm/(?!(nanoid@5|nanoid|url-alphabet))'
  ],
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^(.*/utils/esm-dirname)(\\.js)?$': '<rootDir>/src/utils/__mocks__/esm-dirname.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@logger/(.*)$': '<rootDir>/src/logger/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1'
  }
}
