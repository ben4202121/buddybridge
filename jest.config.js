/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // 启用 Obsidian API mock，便于未来为视图/设置等模块补测
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/tests/mocks/obsidian.ts'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  },
  // 覆盖率统计范围：单测覆盖的核心模块（UI 模块需 DOM 集成，另行覆盖）
  collectCoverageFrom: [
    'src/api.ts',
    'src/types.ts',
    'src/context.ts',
    'src/io.ts',
    'src/chat/**/*.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 50,
      functions: 70,
      lines: 70
    }
  }
};
