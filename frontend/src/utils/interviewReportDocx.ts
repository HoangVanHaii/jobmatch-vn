/**
 * interviewReportDocx.ts — Xuất file Báo cáo Phỏng vấn (.docx) chuẩn doanh nghiệp
 * Khởi tạo từ mẫu JobMatchVN_Mau_Bao_cao_Phong_van_v3.docx
 * Bao gồm đầy đủ 9 phần chuẩn hóa:
 * 01. Giới thiệu & Mục đích báo cáo (Bảng thông tin hệ thống, đơn vị, người lập)
 * 02. Chỉ số tổng quan KPIs (4 thẻ trực quan)
 * 03. Tình trạng buổi phỏng vấn (Bảng thống kê tỷ lệ)
 * 04. Phân loại hình thức & loại hình phỏng vấn
 * 05. Top vị trí tuyển dụng có nhiều phỏng vấn nhất
 * 06. Danh sách chi tiết các buổi phỏng vấn (Hội đồng, thời gian, hình thức, trạng thái)
 * 07. Đánh giá & Nhận xét chất lượng phỏng vấn
 * 08. Đề xuất & Kế hoạch hành động tiếp theo
 * 09. Xác nhận & Phê duyệt (Chữ ký người lập & người phê duyệt)
 */
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  Packer,
  ShadingType,
  ImageRun,
} from 'docx';
import type { InterviewEvent, InterviewStatus } from '@/views/employer/InterviewsView.vue';
import { REPORT_LOGO_BASE64 } from '@/assets/reportLogoBase64';

export interface ReportDocxData {
  periodLabel: string;
  companyName?: string;
  reporterName?: string;
  totalInterviews: number;
  totalCandidates: number;
  totalDuration: string;
  panelCoverage: number;
  statusBreakdown: Record<InterviewStatus, number>;
  typeBreakdown: Array<{ type: string; count: number; percent: number }>;
  jobBreakdown: Array<{ job: string; count: number }>;
  events: InterviewEvent[];
}

// Bảng màu chuẩn từ Template v3
const COLOR_NAVY = '0B1F3A';      // Dark Navy (Tiêu đề, text chính, số liệu)
const COLOR_TEAL = '0D9488';      // Teal Accent (Logo VN, số mục 01..09, viền banner)
const COLOR_SLATE_DARK = '475569';// Slate 600 (Text phụ, nhãn cột, mô tả)
const COLOR_SLATE_MUTED = '94A3B8';// Slate 400 (Text mờ, ghi chú, STT)
const COLOR_BORDER = 'E2E8F0';    // Slate 200 (Đường kẻ ngang phân tách nhẹ)
const COLOR_HEADER_BG = 'F1F5F9'; // Slate 100 (Nền tiêu đề bảng)

// Màu sắc chấm tròn trạng thái phỏng vấn
const STATUS_COLORS: Record<InterviewStatus, { text: string; dotColor: string }> = {
  scheduled: { text: 'Đã lên lịch (Scheduled)', dotColor: '1D4ED8' },
  in_progress: { text: 'Đang diễn ra (In Progress)', dotColor: 'F59E0B' },
  completed: { text: 'Hoàn thành (Completed)', dotColor: '16A34A' },
  rescheduled: { text: 'Đã dời lịch (Rescheduled)', dotColor: '8B5CF6' },
  cancelled: { text: 'Đã hủy (Cancelled)', dotColor: 'DC2626' },
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper: Tạo tiêu đề mục (01..09)
function createSectionHeading(numStr: string, titleStr: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    children: [
      new TextRun({
        text: `${numStr}  `,
        bold: true,
        size: 20, // 10pt
        color: COLOR_TEAL,
        font: 'Arial',
      }),
      new TextRun({
        text: titleStr,
        bold: true,
        size: 22, // 11pt
        color: COLOR_NAVY,
        font: 'Arial',
      }),
    ],
  });
}

// Helper: Tạo cell bảng chuẩn
function createCell(
  content: Paragraph | Paragraph[],
  widthPercent: number,
  options: {
    isHeader?: boolean;
    align?: any;
    bg?: string;
    hasBottomBorder?: boolean;
    hasAllBorders?: boolean;
    bottomBorderColor?: string;
    padding?: { top?: number; bottom?: number; left?: number; right?: number };
  } = {}
): TableCell {
  const paragraphs = Array.isArray(content) ? content : [content];
  const pad = options.padding || { top: 90, bottom: 90, left: 120, right: 120 };

  let borders: any = {
    top: { style: BorderStyle.NONE },
    bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
  };

  if (options.hasAllBorders) {
    borders = {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
    };
  } else if (options.hasBottomBorder) {
    borders = {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: options.bottomBorderColor || COLOR_BORDER },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
    };
  }

  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: options.bg
      ? { type: ShadingType.CLEAR, fill: options.bg }
      : options.isHeader
        ? { type: ShadingType.CLEAR, fill: COLOR_HEADER_BG }
        : undefined,
    margins: {
      top: pad.top,
      bottom: pad.bottom,
      left: pad.left,
      right: pad.right,
    },
    borders,
    children: paragraphs,
  });
}

export async function exportInterviewReportDocx(data: ReportDocxData): Promise<void> {
  const now = new Date();
  const dateFormatted = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const reportCode = `JM-BC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 18, // 9pt chuẩn template
            color: COLOR_NAVY,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1300, bottom: 1100, left: 900, right: 900 },
          },
        },
        children: [
          // =========================================================================
          // TABLE 0: BANNER HEADER (Logo + Tên thương hiệu + Tiêu đề báo cáo)
          // =========================================================================
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 13, type: WidthType.PERCENTAGE },
                    margins: { top: 40, bottom: 100, left: 40, right: 40 },
                    borders: {
                      top: { style: BorderStyle.NONE },
                      bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR_TEAL },
                      left: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                    },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new ImageRun({
                            data: base64ToUint8Array(REPORT_LOGO_BASE64),
                            transformation: { width: 44, height: 44 },
                            type: 'png',
                          }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 87, type: WidthType.PERCENTAGE },
                    margins: { top: 20, bottom: 100, left: 100, right: 40 },
                    borders: {
                      top: { style: BorderStyle.NONE },
                      bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR_TEAL },
                      left: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                    },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: 'JOBMATCH ', bold: true, size: 18, color: COLOR_NAVY }),
                          new TextRun({ text: 'VN', bold: true, size: 18, color: COLOR_TEAL }),
                          new TextRun({
                            text: '   |   Hệ thống nền tảng tuyển dụng thông minh & Sắp xếp lịch phỏng vấn tự động',
                            size: 16,
                            color: COLOR_SLATE_MUTED,
                          }),
                        ],
                      }),
                      new Paragraph({
                        spacing: { before: 60, after: 40 },
                        children: [
                          new TextRun({ text: 'BÁO CÁO TỔNG QUAN PHỎNG VẤN', bold: true, size: 30, color: COLOR_NAVY }),
                        ],
                      }),
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: `Kỳ báo cáo: ${data.periodLabel}  ·  Ngày xuất: ${dateFormatted}`,
                            size: 17,
                            color: COLOR_SLATE_DARK,
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),

          // =========================================================================
          // 01. GIỚI THIỆU & MỤC ĐÍCH BÁO CÁO
          // =========================================================================
          createSectionHeading('01', 'Giới thiệu & Mục đích báo cáo'),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: 'Báo cáo này tổng hợp toàn bộ kết quả, tiến độ và chất lượng công tác tổ chức phỏng vấn tuyển dụng trong kỳ. Dữ liệu cung cấp góc nhìn toàn diện cho Ban Giám đốc và Bộ phận Nhân sự (HR) nhằm tối ưu quy trình sàng lọc, đo lường tỷ lệ phân công hội đồng đánh giá và đưa ra các quyết định tuyển dụng chính xác, kịp thời.',
                size: 18,
                color: COLOR_SLATE_DARK,
              }),
            ],
          }),

          // BẢNG METADATA (Table 1)
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Hệ thống', size: 16, color: COLOR_SLATE_MUTED })] }), 14, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'JobMatch VN – Employer Workspace', bold: true, size: 18, color: COLOR_NAVY })] }), 36, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Đơn vị', size: 16, color: COLOR_SLATE_MUTED })] }), 14, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: data.companyName || 'Doanh nghiệp tuyển dụng JobMatch VN', size: 18, color: COLOR_SLATE_DARK })] }), 36, { hasBottomBorder: true }),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Người lập', size: 16, color: COLOR_SLATE_MUTED })] }), 14, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: data.reporterName || 'Bộ phận Tuyển dụng (HR)', size: 18, color: COLOR_SLATE_DARK })] }), 36, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Ngày lập', size: 16, color: COLOR_SLATE_MUTED })] }), 14, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: dateFormatted, size: 18, color: COLOR_SLATE_DARK })] }), 36, { hasBottomBorder: true }),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Mã báo cáo', size: 16, color: COLOR_SLATE_MUTED })] }), 14, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: reportCode, size: 18, color: COLOR_SLATE_DARK })] }), 36, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Phiên bản', size: 16, color: COLOR_SLATE_MUTED })] }), 14, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: '1.0 (Chính thức)', bold: true, size: 18, color: COLOR_NAVY })] }), 36, { hasBottomBorder: true }),
                ],
              }),
            ],
          }),

          // =========================================================================
          // 02. CHỈ SỐ TỔNG QUAN (KPIS)
          // =========================================================================
          createSectionHeading('02', 'Chỉ số tổng quan (KPIs)'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  // KPI 1: Tổng buổi phỏng vấn
                  createCell(
                    [
                      new Paragraph({ children: [new TextRun({ text: 'Tổng buổi phỏng vấn', size: 15, color: COLOR_SLATE_DARK })] }),
                      new Paragraph({
                        spacing: { before: 40, after: 30 },
                        children: [
                          new TextRun({ text: String(data.totalInterviews), bold: true, size: 34, color: COLOR_NAVY }),
                          new TextRun({ text: ' buổi', size: 16, color: COLOR_SLATE_DARK }),
                        ],
                      }),
                      new Paragraph({ children: [new TextRun({ text: 'Tổng số lịch đã xếp trong kỳ', size: 14, color: COLOR_SLATE_MUTED })] }),
                    ],
                    25,
                    { hasAllBorders: true, padding: { top: 100, bottom: 100, left: 110, right: 110 } }
                  ),
                  // KPI 2: Số ứng viên tham gia
                  createCell(
                    [
                      new Paragraph({ children: [new TextRun({ text: 'Số ứng viên tham gia', size: 15, color: COLOR_SLATE_DARK })] }),
                      new Paragraph({
                        spacing: { before: 40, after: 30 },
                        children: [
                          new TextRun({ text: String(data.totalCandidates), bold: true, size: 34, color: COLOR_NAVY }),
                          new TextRun({ text: ' người', size: 16, color: COLOR_SLATE_DARK }),
                        ],
                      }),
                      new Paragraph({ children: [new TextRun({ text: 'Ứng viên độc lập được mời', size: 14, color: COLOR_SLATE_MUTED })] }),
                    ],
                    25,
                    { hasAllBorders: true, padding: { top: 100, bottom: 100, left: 110, right: 110 } }
                  ),
                  // KPI 3: Tổng thời lượng
                  createCell(
                    [
                      new Paragraph({ children: [new TextRun({ text: 'Tổng thời lượng', size: 15, color: COLOR_SLATE_DARK })] }),
                      new Paragraph({
                        spacing: { before: 40, after: 30 },
                        children: [
                          new TextRun({ text: data.totalDuration, bold: true, size: 30, color: COLOR_NAVY }),
                        ],
                      }),
                      new Paragraph({ children: [new TextRun({ text: 'Quỹ thời gian hội đồng đã dành', size: 14, color: COLOR_SLATE_MUTED })] }),
                    ],
                    25,
                    { hasAllBorders: true, padding: { top: 100, bottom: 100, left: 110, right: 110 } }
                  ),
                  // KPI 4: Tỷ lệ đã xếp hội đồng
                  createCell(
                    [
                      new Paragraph({ children: [new TextRun({ text: 'Tỷ lệ đã xếp hội đồng', size: 15, color: COLOR_SLATE_DARK })] }),
                      new Paragraph({
                        spacing: { before: 40, after: 30 },
                        children: [
                          new TextRun({ text: String(data.panelCoverage), bold: true, size: 34, color: COLOR_NAVY }),
                          new TextRun({ text: ' %', size: 16, color: COLOR_SLATE_DARK }),
                        ],
                      }),
                      new Paragraph({ children: [new TextRun({ text: 'Buổi đã phân công người PV', size: 14, color: COLOR_SLATE_MUTED })] }),
                    ],
                    25,
                    { hasAllBorders: true, padding: { top: 100, bottom: 100, left: 110, right: 110 } }
                  ),
                ],
              }),
            ],
          }),

          // =========================================================================
          // 03. TÌNH TRẠNG BUỔI PHỎNG VẤN
          // =========================================================================
          createSectionHeading('03', 'Tình trạng buổi phỏng vấn'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              // Header Row
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 7, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'TRẠNG THÁI', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 45, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'SỐ BUỔI', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 24, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'TỶ LỆ (%)', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 24, { isHeader: true }),
                ],
              }),
              // Status Rows
              ...(
                (['scheduled', 'in_progress', 'completed', 'rescheduled', 'cancelled'] as InterviewStatus[]).map((st, idx) => {
                  const count = data.statusBreakdown[st] || 0;
                  const pct = data.totalInterviews > 0 ? Math.round((count / data.totalInterviews) * 100) : 0;
                  const meta = STATUS_COLORS[st];
                  return new TableRow({
                    children: [
                      createCell(new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 18, color: COLOR_SLATE_MUTED })] }), 7, { hasBottomBorder: true }),
                      createCell(
                        new Paragraph({
                          children: [
                            new TextRun({ text: '●  ', size: 18, color: meta.dotColor }),
                            new TextRun({ text: meta.text, size: 18, color: COLOR_NAVY }),
                          ],
                        }),
                        45,
                        { hasBottomBorder: true }
                      ),
                      createCell(new Paragraph({ children: [new TextRun({ text: String(count), size: 18, color: COLOR_NAVY })] }), 24, { hasBottomBorder: true }),
                      createCell(new Paragraph({ children: [new TextRun({ text: `${pct}%`, size: 18, color: COLOR_NAVY })] }), 24, { hasBottomBorder: true }),
                    ],
                  });
                })
              ),
              // Summary Row
              new TableRow({
                children: [
                  createCell(new Paragraph(''), 7, { bg: COLOR_HEADER_BG }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'TỔNG CỘNG', bold: true, size: 18, color: COLOR_NAVY })] }), 45, { bg: COLOR_HEADER_BG }),
                  createCell(new Paragraph({ children: [new TextRun({ text: String(data.totalInterviews), bold: true, size: 18, color: COLOR_NAVY })] }), 24, { bg: COLOR_HEADER_BG }),
                  createCell(new Paragraph({ children: [new TextRun({ text: '100%', bold: true, size: 18, color: COLOR_NAVY })] }), 24, { bg: COLOR_HEADER_BG }),
                ],
              }),
            ],
          }),

          // =========================================================================
          // 04. PHÂN LOẠI HÌNH THỨC & LOẠI HÌNH PHỎNG VẤN
          // =========================================================================
          createSectionHeading('04', 'Phân loại hình thức & loại hình phỏng vấn'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'LOẠI HÌNH PHỎNG VẤN', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 33, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'HÌNH THỨC', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 30, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'SỐ BUỔI', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 18.5, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'TỶ LỆ (%)', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 18.5, { isHeader: true }),
                ],
              }),
              ...(
                data.typeBreakdown.length > 0
                  ? data.typeBreakdown.map((item) => {
                      const method = item.type.toLowerCase().includes('kỹ thuật')
                        ? 'Google Meet / Trực tiếp'
                        : item.type.toLowerCase().includes('nhân sự')
                        ? 'Google Meet / Văn phòng'
                        : item.type.toLowerCase().includes('lập trình')
                        ? 'Online Coding Platform'
                        : 'Trực tiếp / Trực tuyến';
                      return new TableRow({
                        children: [
                          createCell(new Paragraph({ children: [new TextRun({ text: item.type, bold: true, size: 18, color: COLOR_NAVY })] }), 33, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: method, size: 18, color: COLOR_NAVY })] }), 30, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: String(item.count), size: 18, color: COLOR_NAVY })] }), 18.5, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: `${item.percent}%`, size: 18, color: COLOR_NAVY })] }), 18.5, { hasBottomBorder: true }),
                        ],
                      });
                    })
                  : [
                      new TableRow({
                        children: [
                          createCell(new Paragraph({ children: [new TextRun({ text: 'Phỏng vấn Kỹ thuật (Technical)', bold: true, size: 18, color: COLOR_NAVY })] }), 33, { hasBottomBorder: true }),
                          createCell(new Paragraph('Google Meet / Trực tiếp'), 30, { hasBottomBorder: true }),
                          createCell(new Paragraph('0'), 18.5, { hasBottomBorder: true }),
                          createCell(new Paragraph('0%'), 18.5, { hasBottomBorder: true }),
                        ],
                      }),
                      new TableRow({
                        children: [
                          createCell(new Paragraph({ children: [new TextRun({ text: 'Phỏng vấn Văn hóa / Nhân sự (HR)', bold: true, size: 18, color: COLOR_NAVY })] }), 33, { hasBottomBorder: true }),
                          createCell(new Paragraph('Google Meet / Văn phòng'), 30, { hasBottomBorder: true }),
                          createCell(new Paragraph('0'), 18.5, { hasBottomBorder: true }),
                          createCell(new Paragraph('0%'), 18.5, { hasBottomBorder: true }),
                        ],
                      }),
                    ]
              ),
            ],
          }),

          // =========================================================================
          // 05. TOP VỊ TRÍ TUYỂN DỤNG CÓ NHIỀU PHỎNG VẤN NHẤT
          // =========================================================================
          createSectionHeading('05', 'Top vị trí tuyển dụng có nhiều phỏng vấn nhất'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 7, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'VỊ TRÍ TUYỂN DỤNG', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 50, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'SỐ BUỔI PHỎNG VẤN', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 22, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'TỶ LỆ ĐÓNG GÓP', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 21, { isHeader: true }),
                ],
              }),
              ...(
                data.jobBreakdown.length > 0
                  ? data.jobBreakdown.slice(0, 5).map((item, idx) => {
                      const share = data.totalInterviews > 0 ? Math.round((item.count / data.totalInterviews) * 100) : 0;
                      return new TableRow({
                        children: [
                          createCell(new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 18, color: COLOR_SLATE_MUTED })] }), 7, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: item.job, bold: true, size: 18, color: COLOR_NAVY })] }), 50, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: String(item.count), size: 18, color: COLOR_NAVY })] }), 22, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: `${share}%`, size: 18, color: COLOR_NAVY })] }), 21, { hasBottomBorder: true }),
                        ],
                      });
                    })
                  : [
                      new TableRow({
                        children: [
                          createCell(new Paragraph('1'), 7, { hasBottomBorder: true }),
                          createCell(new Paragraph('Chưa có vị trí phỏng vấn trong kỳ'), 50, { hasBottomBorder: true }),
                          createCell(new Paragraph('0'), 22, { hasBottomBorder: true }),
                          createCell(new Paragraph('0%'), 21, { hasBottomBorder: true }),
                        ],
                      }),
                    ]
              ),
            ],
          }),

          // =========================================================================
          // 06. DANH SÁCH CHI TIẾT CÁC BUỔI PHỎNG VẤN
          // =========================================================================
          createSectionHeading('06', 'Danh sách chi tiết các buổi phỏng vấn'),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: 'Ghi chú: Cột “Người PV / Hội đồng” theo dõi cán bộ tham gia đánh giá để đảm bảo tỷ lệ hoàn thành đánh giá và tính khách quan.',
                size: 16,
                italics: true,
                color: COLOR_SLATE_MUTED,
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: '#', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 4.5, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'ỨNG VIÊN', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 15, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'VỊ TRÍ ỨNG TUYỂN', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 17, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'THỜI GIAN', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 15, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'HÌNH THỨC', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 15, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'NGƯỜI PV / HỘI ĐỒNG', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 19, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'TRẠNG THÁI', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 14.5, { isHeader: true }),
                ],
              }),
              ...(
                data.events.length > 0
                  ? data.events.map((evt, idx) => {
                      const interviewerNames = evt.interviewers.map((i) => i.name).filter(Boolean).join(', ');
                      const statusMeta = STATUS_COLORS[evt.status] || { text: evt.status, dotColor: '64748B' };

                      // Format ngày dạng DD/MM/YYYY
                      let dateStr = evt.date;
                      if (dateStr && dateStr.includes('-')) {
                        const [y, m, d] = dateStr.split('-');
                        dateStr = `${d}/${m}/${y}`;
                      }

                      return new TableRow({
                        children: [
                          createCell(new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 18, color: COLOR_SLATE_MUTED })] }), 4.5, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: evt.candidateName, bold: true, size: 18, color: COLOR_NAVY })] }), 15, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: evt.jobTitle, size: 18, color: COLOR_NAVY })] }), 17, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: `${evt.startTime} - ${evt.endTime}\n(${dateStr})`, size: 17, color: COLOR_NAVY })] }), 15, { hasBottomBorder: true }),
                          createCell(new Paragraph({ children: [new TextRun({ text: evt.location, size: 18, color: COLOR_NAVY })] }), 15, { hasBottomBorder: true }),
                          createCell(
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: interviewerNames || 'Chưa chỉ định',
                                  bold: !interviewerNames,
                                  size: 18,
                                  color: interviewerNames ? COLOR_NAVY : 'DC2626',
                                }),
                              ],
                            }),
                            19,
                            { hasBottomBorder: true }
                          ),
                          createCell(
                            new Paragraph({
                              children: [
                                new TextRun({ text: '● ', size: 16, color: statusMeta.dotColor }),
                                new TextRun({ text: statusMeta.text.split(' ')[0], size: 17, color: COLOR_NAVY }),
                              ],
                            }),
                            14.5,
                            { hasBottomBorder: true }
                          ),
                        ],
                      });
                    })
                  : [
                      new TableRow({
                        children: [
                          createCell(new Paragraph('-'), 4.5, { hasBottomBorder: true }),
                          createCell(new Paragraph('Không có dữ liệu'), 15, { hasBottomBorder: true }),
                          createCell(new Paragraph('-'), 17, { hasBottomBorder: true }),
                          createCell(new Paragraph('-'), 15, { hasBottomBorder: true }),
                          createCell(new Paragraph('-'), 15, { hasBottomBorder: true }),
                          createCell(new Paragraph('-'), 19, { hasBottomBorder: true }),
                          createCell(new Paragraph('-'), 14.5, { hasBottomBorder: true }),
                        ],
                      }),
                    ]
              ),
            ],
          }),

          // =========================================================================
          // 07. ĐÁNH GIÁ & NHẬN XÉT CHẤT LƯỢNG PHỎNG VẤN
          // =========================================================================
          createSectionHeading('07', 'Đánh giá & Nhận xét chất lượng phỏng vấn'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Đánh giá chung', bold: true, size: 17, color: COLOR_NAVY })] }), 21, { hasBottomBorder: true }),
                  createCell(
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `Trong kỳ ghi nhận tổng cộng ${data.totalInterviews} buổi phỏng vấn đối với ${data.totalCandidates} ứng viên tiềm năng. Quy trình phỏng vấn diễn ra ổn định, đúng tiến độ và đảm bảo trải nghiệm ứng viên chuyên nghiệp.`,
                          size: 18,
                          color: COLOR_SLATE_DARK,
                        }),
                      ],
                    }),
                    79,
                    { hasBottomBorder: true }
                  ),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Điểm đạt được', bold: true, size: 17, color: COLOR_NAVY })] }), 21, { hasBottomBorder: true }),
                  createCell(
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `Tỷ lệ phân công hội đồng đạt ${data.panelCoverage}%. ${
                            data.panelCoverage >= 80
                              ? 'Hầu hết các buổi phỏng vấn đều được phân công Interviewer rõ ràng, đúng chuyên môn.'
                              : 'Bộ phận HR đã phối hợp tích cực với các bộ phận để phân bổ người phỏng vấn phù hợp.'
                          } Ứng viên phản hồi lịch đúng giờ thông qua cổng xác nhận trực tuyến của JobMatch VN.`,
                          size: 18,
                          color: COLOR_SLATE_DARK,
                        }),
                      ],
                    }),
                    79,
                    { hasBottomBorder: true }
                  ),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Tồn tại / Thách thức', bold: true, size: 17, color: COLOR_NAVY })] }), 21, { hasBottomBorder: true }),
                  createCell(
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: `${
                            data.statusBreakdown.rescheduled + data.statusBreakdown.cancelled > 0
                              ? `Ghi nhận ${data.statusBreakdown.rescheduled} buổi cần dời lịch và ${data.statusBreakdown.cancelled} buổi bị hủy. Cần chuẩn bị thêm người phỏng vấn dự phòng để hạn chế ảnh hưởng đến kế hoạch tuyển dụng.`
                              : 'Lịch trình được duy trì ổn định, không có ca hủy hoặc dời lịch đột xuất đáng kể.'
                          }`,
                          size: 18,
                          color: COLOR_SLATE_DARK,
                        }),
                      ],
                    }),
                    79,
                    { hasBottomBorder: true }
                  ),
                ],
              }),
            ],
          }),

          // =========================================================================
          // 08. ĐỀ XUẤT & KẾ HOẠCH HÀNH ĐỘNG TIẾP THEO
          // =========================================================================
          createSectionHeading('08', 'Đề xuất & Kế hoạch hành động tiếp theo'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 7, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'NỘI DUNG ĐỀ XUẤT / HÀNH ĐỘNG', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 52, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'NGƯỜI PHỤ TRÁCH', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 22, { isHeader: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'THỜI HẠN', bold: true, size: 16, color: COLOR_SLATE_DARK })] }), 19, { isHeader: true }),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: '1', size: 18, color: COLOR_SLATE_MUTED })] }), 7, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Chốt kết quả vòng 2 và gửi Offer cho các ứng viên đạt yêu cầu', size: 18, color: COLOR_NAVY })] }), 52, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Phòng Tuyển dụng (HR)', size: 18, color: COLOR_NAVY })] }), 22, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Trong 48h sau phỏng vấn', size: 18, color: COLOR_SLATE_DARK })] }), 19, { hasBottomBorder: true }),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: '2', size: 18, color: COLOR_SLATE_MUTED })] }), 7, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Mở đợt phỏng vấn bổ sung cho vị trí còn thiếu quota theo kế hoạch', size: 18, color: COLOR_NAVY })] }), 52, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Lead Recruiter', size: 18, color: COLOR_NAVY })] }), 22, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Tuần tiếp theo', size: 18, color: COLOR_SLATE_DARK })] }), 19, { hasBottomBorder: true }),
                ],
              }),
              new TableRow({
                children: [
                  createCell(new Paragraph({ children: [new TextRun({ text: '3', size: 18, color: COLOR_SLATE_MUTED })] }), 7, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Tối ưu hóa thời gian trả kết quả phỏng vấn dưới 48 giờ', size: 18, color: COLOR_NAVY })] }), 52, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Hội đồng phỏng vấn', size: 18, color: COLOR_NAVY })] }), 22, { hasBottomBorder: true }),
                  createCell(new Paragraph({ children: [new TextRun({ text: 'Định kỳ hàng tuần', size: 18, color: COLOR_SLATE_DARK })] }), 19, { hasBottomBorder: true }),
                ],
              }),
            ],
          }),

          // =========================================================================
          // 09. XÁC NHẬN & PHÊ DUYỆT
          // =========================================================================
          createSectionHeading('09', 'Xác nhận & Phê duyệt'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    margins: { top: 120, bottom: 120, left: 100, right: 100 },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
                      bottom: { style: BorderStyle.NONE },
                      left: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                    },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: 'NGƯỜI LẬP BÁO CÁO', bold: true, size: 17, color: COLOR_NAVY })],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 360 },
                        children: [new TextRun({ text: '(Ký và ghi rõ họ tên)', size: 15, color: COLOR_SLATE_DARK })],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: data.reporterName || 'Bộ phận Tuyển dụng (HR)', bold: true, size: 18, color: COLOR_NAVY })],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: 'Chuyên viên Tuyển dụng', size: 16, color: COLOR_SLATE_DARK })],
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    margins: { top: 120, bottom: 120, left: 100, right: 100 },
                    borders: {
                      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
                      bottom: { style: BorderStyle.NONE },
                      left: { style: BorderStyle.NONE },
                      right: { style: BorderStyle.NONE },
                    },
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: 'NGƯỜI PHÊ DUYỆT', bold: true, size: 17, color: COLOR_NAVY })],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 360 },
                        children: [new TextRun({ text: '(Ký, ghi rõ họ tên & đóng dấu)', size: 15, color: COLOR_SLATE_DARK })],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: 'Trưởng bộ phận Nhân sự', bold: true, size: 18, color: COLOR_NAVY })],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: 'Giám đốc Nhân sự / HR Director', size: 16, color: COLOR_SLATE_DARK })],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });

  // Tải file Word trực tiếp trên trình duyệt
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileNameClean = data.periodLabel.replace(/[\/\s–—:]+/g, '_');
  a.download = `Bao_cao_tong_quan_phong_van_${fileNameClean}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
