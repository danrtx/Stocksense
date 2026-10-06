// Pruebas unitarias (src, *.spec.ts) y de integración (test, *.e2e-spec.ts).
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/database/**'],
  coverageDirectory: 'coverage',
  // RNF-07: al menos 70% de cobertura en la lógica de negocio.
  coverageThreshold: { global: { statements: 70, lines: 70, functions: 70 } },
  testEnvironment: 'node',
  testTimeout: 30000,
};
