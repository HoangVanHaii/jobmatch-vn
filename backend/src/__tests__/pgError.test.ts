/**
 * Unit test getPgErrorCode (TASK 2 — M-01 fix).
 * Helper duyệt chain .cause để tìm Postgres error code 5 ký tự.
 */
import { getPgErrorCode } from '../utils/pgError';

describe('getPgErrorCode', () => {
  it('đọc trực tiếp err.code khi error là pg error gốc', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(getPgErrorCode(err)).toBe('23505');
  });

  it('duyệt .cause 1 cấp (DrizzleQueryError bọc pg error)', () => {
    const pgErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const wrapped = new Error('query failed', { cause: pgErr });
    expect(getPgErrorCode(wrapped)).toBe('23505');
  });

  it('duyệt .cause 2 cấp', () => {
    const pgErr = Object.assign(new Error('fk violation'), { code: '23503' });
    const mid = new Error('insert failed', { cause: pgErr });
    const top = new Error('request failed', { cause: mid });
    expect(getPgErrorCode(top)).toBe('23503');
  });

  it('trả undefined khi không có code nào trong chain', () => {
    expect(getPgErrorCode(new Error('plain'))).toBeUndefined();
    expect(getPgErrorCode(new Error('wrapped', { cause: new Error('inner') }))).toBeUndefined();
    expect(getPgErrorCode(undefined)).toBeUndefined();
    expect(getPgErrorCode(null)).toBeUndefined();
    expect(getPgErrorCode('string error')).toBeUndefined();
  });

  it('bỏ qua code không đúng 5 ký tự', () => {
    const err = new Error('weird', { cause: { code: 'TOO_LONG_CODE' } });
    expect(getPgErrorCode(err)).toBeUndefined();
  });

  it('giới hạn độ sâu 5 — code ở sâu hơn không đọc được', () => {
    let deep: unknown = { code: '23505' };
    for (let i = 0; i < 8; i += 1) deep = { cause: deep };
    expect(getPgErrorCode(deep)).toBeUndefined();

    let shallow: unknown = { code: '23505' };
    for (let i = 0; i < 3; i += 1) shallow = { cause: shallow };
    expect(getPgErrorCode(shallow)).toBe('23505');
  });
});
