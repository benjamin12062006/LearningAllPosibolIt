const suites = {
  unit: '**/*.spec.js',
  integration: '**/*.int-spec.js',
  e2e: '**/*.e2e-spec.js',
};

export default {
  testTimeout: 60_000,
  projects: Object.entries(suites).map(([name, pattern]) => ({
    displayName: name,
    rootDir: '.',
    roots: ['<rootDir>/.test-build'],
    testEnvironment: 'node',
    transform: {},
    testMatch: [`<rootDir>/.test-build/test/features/${pattern}`],
    setupFiles: ['<rootDir>/.test-build/test/features/support/isolated-env.js'],
    restoreMocks: true,
  })),
  collectCoverageFrom: [
    '<rootDir>/.test-build/src/common/http/**/*.js',
    '<rootDir>/.test-build/src/projects/**/*.js',
    '<rootDir>/.test-build/src/catalog-import/**/*.js',
    '!**/*.module.js',
    '!**/*.types.js',
  ],
  coverageDirectory: '<rootDir>/coverage/features',
  coverageProvider: 'v8',
  watchman: false,
};
