/**
 * Jest config — TASK 1 (C-01/C-02) thêm test đầu tiên của backend.
 *
 * - preset ts-jest, CommonJS (khớp tsconfig.json module: commonjs).
 * - Test đặt tại src/__tests__/*.test.ts.
 * - Integration test đọc DATABASE_URL từ .env (qua config/env dotenv) —
 *   chỉ SELECT, không create/delete fixture.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Transpile-only: type correctness được gate riêng bởi `npx tsc --noEmit`
  // (ts-jest per-file typecheck báo type-error ma giữa lib langchain versions
  // mà full-program tsc với skipLibCheck bỏ qua).
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  // Import app kéo theo pool pg + Redis + BullMQ connections không có teardown
  // trong test → forceExit để jest không treo sau khi xong.
  forceExit: true,
};
