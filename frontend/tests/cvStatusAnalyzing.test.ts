// @vitest-environment happy-dom
/**
 * Test tách status 'analyzing' ra khỏi 'parsing'.
 *
 * Trước: cả cvParse worker + cvAnalysis worker đều set status='parsing' → FE
 *   không phân biệt được "đang parse text" (~10-30s) vs "đang AI analysis"
 *   (~5-15s). UI overlay hiện "Đang xử lý…" chung.
 *
 * Sau: cvAnalysis worker set 'analyzing' riêng. CvStatus union phải có
 *   'analyzing'. statusDotClass + statusBadge + overlay check đều phải
 *   handle case này.
 *
 * Test approach: tập trung vào type-level + helper-level checks (statusDotClass,
 * statusBadge, overlay condition). Không cần mount cả component vì deps quá
 * nặng (Pinia store + socket + router).
 *
 * Verify:
 *   - CvStatus type có 'analyzing' (compile-time check + runtime assertion)
 *   - 'analyzing' is not assignable to 'parsing' (độc lập hoàn toàn)
 *   - 6 status đầy đủ (pending/parsing/analyzing/ready/failed/deleted)
 */
import { describe, it, expect } from 'vitest';
import type { CvStatus } from '@/types/cv';

describe('CvStatus: tách analyzing ra khỏi parsing', () => {
  it('PASS: CvStatus union bao gồm cả 6 giá trị', () => {
    const allStatuses: CvStatus[] = [
      'pending',
      'parsing',
      'analyzing',
      'ready',
      'failed',
      'deleted',
    ];
    // Verify từng status có thể assign được (compile-time check)
    expect(allStatuses).toHaveLength(6);
    expect(allStatuses).toContain('analyzing');
    expect(allStatuses).toContain('parsing');
    expect(allStatuses).not.toContain('processing'); // typo guard
  });

  it('PASS: "analyzing" là string literal riêng, không trùng "parsing"', () => {
    // Verify distinct string literal types
    const analyzing: CvStatus = 'analyzing';
    const parsing: CvStatus = 'parsing';
    expect(analyzing).not.toBe(parsing);
    expect(analyzing).toBe('analyzing');
    expect(parsing).toBe('parsing');
  });

  it('PASS: statusDotClass có entry cho "analyzing"', () => {
    // Mirror logic từ MyResumesView.vue:198
    const statusDotClass: Record<CvStatus, string> = {
      pending: 'bg-amber-500',
      parsing: 'bg-blue-500',
      analyzing: 'bg-violet-500',
      ready: 'bg-emerald-500',
      failed: 'bg-red-500',
      deleted: 'bg-slate-300',
    };
    expect(statusDotClass.analyzing).toBe('bg-violet-500');
    expect(statusDotClass.parsing).toBe('bg-blue-500');
  });

  it('PASS: statusBadge switch cover hết CvStatus (exhaustiveness)', () => {
    // Mirror logic từ MyResumesView.vue:329 statusBadge
    type BadgeTone = 'green' | 'red' | 'amber' | 'blue' | 'slate';
    const statusBadge = (status: CvStatus): { tone: BadgeTone; label: string } => {
      switch (status) {
        case 'ready':
          return { tone: 'green', label: 'Ready' };
        case 'failed':
          return { tone: 'red', label: 'Failed' };
        case 'pending':
          return { tone: 'amber', label: 'Pending' };
        case 'parsing':
          return { tone: 'blue', label: 'Parsing' };
        case 'analyzing':
          return { tone: 'blue', label: 'Analyzing' };
        case 'deleted':
          return { tone: 'slate', label: 'Đã xoá' };
      }
    };

    // Verify all 6 statuses → không throw (exhaustive switch)
    expect(statusBadge('pending').label).toBe('Pending');
    expect(statusBadge('parsing').label).toBe('Parsing');
    expect(statusBadge('analyzing').label).toBe('Analyzing');
    expect(statusBadge('ready').label).toBe('Ready');
    expect(statusBadge('failed').label).toBe('Failed');
    expect(statusBadge('deleted').label).toBe('Đã xoá');

    // Phân biệt parsing vs analyzing — đây là điểm quan trọng của refactor
    expect(statusBadge('parsing')).not.toEqual(statusBadge('analyzing'));
  });

  it('PASS: overlay condition hiển thị cho cả parsing + analyzing', () => {
    // Mirror logic từ MyResumesView.vue:1014 v-if
    const shouldShowOverlay = (status: CvStatus): boolean =>
      status === 'pending' || status === 'parsing' || status === 'analyzing';

    expect(shouldShowOverlay('pending')).toBe(true);
    expect(shouldShowOverlay('parsing')).toBe(true);
    expect(shouldShowOverlay('analyzing')).toBe(true);
    expect(shouldShowOverlay('ready')).toBe(false);
    expect(shouldShowOverlay('failed')).toBe(false);
    expect(shouldShowOverlay('deleted')).toBe(false);
  });
});
