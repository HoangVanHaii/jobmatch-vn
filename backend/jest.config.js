module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@router/(.*)$': '<rootDir>/src/router/$1',
    '^@controller/(.*)$': '<rootDir>/src/controller/$1',
    '^@service/(.*)$': '<rootDir>/src/service/$1',
    '^@ai/(.*)$': '<rootDir>/src/ai/$1',
    '^@db/(.*)$': '<rootDir>/src/db/$1',
    '^@socket/(.*)$': '<rootDir>/src/socket/$1',
    '^@jobs/(.*)$': '<rootDir>/src/jobs/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          esModuleInterop: true,
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
};
