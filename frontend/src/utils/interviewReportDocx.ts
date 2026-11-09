/**
 * interviewReportDocx.ts — Xuất file Báo cáo Phỏng vấn (.docx) chuẩn doanh nghiệp
 * Khởi tạo từ dữ liệu lịch phỏng vấn thời gian thực trên JobMatch VN
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
  HeadingLevel,
  Packer,
  ShadingType,
} from 'docx';
import type { InterviewEvent, InterviewStatus } from '@/views/employer/InterviewsView.vue';

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

const PRIMARY_COLOR = '4338CA'; // Indigo 700
const HEADER_BG = 'F1F5F9'; // Slate 100
const BORDER_COLOR = 'CBD5E1'; // Slate 300
const TEXT_MUTED = '64748B'; // Slate 500

const STATUS_TEXT: Record<InterviewStatus, string> = {
  scheduled: 'Đã lên lịch',
  in_progress: 'Đang diễn ra',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  rescheduled: 'Đã dời lịch',
};

function createBorderedCell(
  content: Paragraph | Paragraph[],
  widthPercent: number,
  options: { isHeader?: boolean; align?: any; bg?: string } = {}
): TableCell {
  const paragraphs = Array.isArray(content) ? content : [content];
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: options.bg
      ? { type: ShadingType.CLEAR, fill: options.bg }
      : options.isHeader
        ? { type: ShadingType.CLEAR, fill: HEADER_BG }
        : undefined,
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
    },
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
            font: 'Calibri',
            size: 22, // 11pt
            color: '1E293B',
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch
          },
        },
        children: [
          // 1. BRAND & HEADER
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: 'JOBMATCH VN',
                bold: true,
                size: 26,
                color: PRIMARY_COLOR,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: 'Hệ thống nền tảng tuyển dụng thông minh JobMatch VN',
                italics: true,
                size: 18,
                color: TEXT_MUTED,
              }),
            ],
          }),
          new Paragraph({ text: '' }),

          // TIÊU ĐỀ CHÍNH
          new Paragraph({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: 'BÁO CÁO TỔNG QUAN PHỎNG VẤN',
                bold: true,
                size: 32,
                color: '0F172A',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: `Kỳ báo cáo: ${data.periodLabel}`,
                italics: true,
                size: 22,
                color: PRIMARY_COLOR,
              }),
            ],
          }),

          // BẢNG THÔNG TIN ĐỊNH DANH BÁO CÁO
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Thông tin', bold: true })] }), 30, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Nội dung', bold: true })] }), 70, { isHeader: true }),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('Hệ thống'), 30),
                  createBorderedCell(new Paragraph('JobMatch VN – Employer Workspace'), 70),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('Đơn vị / Doanh nghiệp'), 30),
                  createBorderedCell(new Paragraph(data.companyName || 'Doanh nghiệp tuyển dụng'), 70),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('Người lập báo cáo'), 30),
                  createBorderedCell(new Paragraph(data.reporterName || 'Bộ phận Tuyển dụng & Nhân sự (HR)'), 70),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('Ngày lập báo cáo'), 30),
                  createBorderedCell(new Paragraph(dateFormatted), 70),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('Mã báo cáo'), 30),
                  createBorderedCell(new Paragraph(reportCode), 70),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('Phiên bản'), 30),
                  createBorderedCell(new Paragraph('1.0 (Bản chính thức)'), 70),
                ],
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 200 } }),

          // MỤC 1: GIỚI THIỆU & MỤC ĐÍCH BÁO CÁO
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '1. Giới thiệu & mục đích báo cáo', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Paragraph({
            spacing: { after: 200 },
            alignment: AlignmentType.JUSTIFIED,
            children: [
              new TextRun({
                text: `Báo cáo này tổng hợp dữ liệu lịch trình và tiến độ các buổi phỏng vấn tuyển dụng trong kỳ (${data.periodLabel}). Mục đích cung cấp góc nhìn toàn diện cho Hội đồng Tuyển dụng và Ban Giám đốc về số lượng ứng viên tiếp cận, chất lượng phân công phỏng vấn và phân bố vị trí nhằm tối ưu quy trình tuyển chọn nhân sự.`,
              }),
            ],
          }),

          // MỤC 2: CHỈ SỐ TỔNG QUAN (KPIs)
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '2. Chỉ số tổng quan', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true })] }), 10, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Chỉ số', bold: true })] }), 40, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Giá trị', bold: true })] }), 25, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Ghi chú', bold: true })] }), 25, { isHeader: true }),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('1'), 10),
                  createBorderedCell(new Paragraph('Tổng số buổi phỏng vấn'), 40),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: `${data.totalInterviews} buổi`, bold: true })] }), 25),
                  createBorderedCell(new Paragraph('Đã lên lịch trong kỳ'), 25),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('2'), 10),
                  createBorderedCell(new Paragraph('Số ứng viên tham gia'), 40),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: `${data.totalCandidates} người`, bold: true })] }), 25),
                  createBorderedCell(new Paragraph('Ứng viên duy nhất'), 25),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('3'), 10),
                  createBorderedCell(new Paragraph('Tổng thời lượng phỏng vấn'), 40),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: data.totalDuration, bold: true })] }), 25),
                  createBorderedCell(new Paragraph('Thời gian trao đổi thực tế'), 25),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('4'), 10),
                  createBorderedCell(new Paragraph('Tỷ lệ đã phân công người phỏng vấn'), 40),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: `${data.panelCoverage}%`, bold: true, color: '15803D' })] }), 25),
                  createBorderedCell(new Paragraph(data.panelCoverage >= 80 ? 'Đạt chuẩn sẵn sàng cao' : 'Cần gán thêm interviewer'), 25),
                ],
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 200 } }),

          // MỤC 3: TÌNH TRẠNG BUỔI PHỎNG VẤN
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '3. Tình trạng buổi phỏng vấn', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true })] }), 10, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Trạng thái', bold: true })] }), 40, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Số buổi', bold: true })] }), 25, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Tỷ lệ (%)', bold: true })] }), 25, { isHeader: true }),
                ],
              }),
              ...(['scheduled', 'in_progress', 'completed', 'rescheduled', 'cancelled'] as InterviewStatus[]).map((st, idx) => {
                const count = data.statusBreakdown[st] || 0;
                const pct = data.totalInterviews ? Math.round((count / data.totalInterviews) * 100) : 0;
                return new TableRow({
                  children: [
                    createBorderedCell(new Paragraph(String(idx + 1)), 10),
                    createBorderedCell(new Paragraph(STATUS_TEXT[st]), 40),
                    createBorderedCell(new Paragraph({ children: [new TextRun({ text: String(count), bold: true })] }), 25),
                    createBorderedCell(new Paragraph(`${pct}%`), 25),
                  ],
                });
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 200 } }),

          // MỤC 4: LOẠI HÌNH PHỎNG VẤN
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '4. Phân loại theo loại hình phỏng vấn', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true })] }), 10, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Loại hình phỏng vấn', bold: true })] }), 45, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Số buổi', bold: true })] }), 20, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Tỷ lệ (%)', bold: true })] }), 25, { isHeader: true }),
                ],
              }),
              ...data.typeBreakdown.map((item, idx) => {
                return new TableRow({
                  children: [
                    createBorderedCell(new Paragraph(String(idx + 1)), 10),
                    createBorderedCell(new Paragraph(item.type), 45),
                    createBorderedCell(new Paragraph({ children: [new TextRun({ text: String(item.count), bold: true })] }), 20),
                    createBorderedCell(new Paragraph(`${item.percent}%`), 25),
                  ],
                });
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 200 } }),

          // MỤC 5: TOP VỊ TRÍ TUYỂN DỤNG
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '5. Top vị trí có lịch phỏng vấn', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true })] }), 10, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Vị trí tuyển dụng', bold: true })] }), 60, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Số buổi phỏng vấn', bold: true })] }), 30, { isHeader: true }),
                ],
              }),
              ...data.jobBreakdown.map((item, idx) => {
                return new TableRow({
                  children: [
                    createBorderedCell(new Paragraph(String(idx + 1)), 10),
                    createBorderedCell(new Paragraph(item.job), 60),
                    createBorderedCell(new Paragraph({ children: [new TextRun({ text: `${item.count} buổi`, bold: true })] }), 30),
                  ],
                });
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 200 } }),

          // MỤC 6: DANH SÁCH PHỎNG VẤN CHI TIẾT (Có thêm cột Người phỏng vấn)
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '6. Danh sách phỏng vấn chi tiết', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true })] }), 8, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Ứng viên', bold: true })] }), 20, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Vị trí', bold: true })] }), 22, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Người phỏng vấn', bold: true })] }), 20, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Thời gian', bold: true })] }), 18, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Trạng thái', bold: true })] }), 12, { isHeader: true }),
                ],
              }),
              ...data.events.map((evt, idx) => {
                const interviewerNames = evt.interviewers.map((i) => i.name).filter((n) => n && n !== 'Người phỏng vấn').join(', ') || 'Chưa gán';
                return new TableRow({
                  children: [
                    createBorderedCell(new Paragraph(String(idx + 1)), 8),
                    createBorderedCell(new Paragraph({ children: [new TextRun({ text: evt.candidateName, bold: true })] }), 20),
                    createBorderedCell(new Paragraph(evt.jobTitle), 22),
                    createBorderedCell(new Paragraph(interviewerNames), 20),
                    createBorderedCell(new Paragraph(`${evt.startTime} - ${evt.endTime}\n${evt.date}`), 18),
                    createBorderedCell(new Paragraph(STATUS_TEXT[evt.status]), 12),
                  ],
                });
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 200 } }),

          // MỤC 7: NHẬN XÉT & ĐÁNH GIÁ (Có nội dung tự động gợi ý)
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '7. Nhận xét & đánh giá chung', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `• Tiến độ phỏng vấn: Trong kỳ ghi nhận ${data.totalInterviews} buổi phỏng vấn đối với ${data.totalCandidates} ứng viên tiềm năng.`,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `• Mức độ sẵn sàng của Hội đồng: Đạt ${data.panelCoverage}%. ${
                  data.panelCoverage >= 80
                    ? 'Đa số các buổi phỏng vấn đều được phân công Interviewer rõ ràng, đúng chuyên môn.'
                    : 'Cần phân công bổ sung người phỏng vấn cho các buổi còn trống để đảm bảo trải nghiệm ứng viên.'
                }`,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: '• Đánh giá chất lượng ứng viên: Ứng viên tham gia đúng giờ, phản hồi tốt qua hệ thống họp trực tuyến / trực tiếp tại văn phòng.',
              }),
            ],
          }),

          // MỤC 8: ĐỀ XUẤT & KẾ HOẠCH TIẾP THEO
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: '8. Đề xuất & kế hoạch tiếp theo', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'STT', bold: true })] }), 10, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Nội dung đề xuất / Kế hoạch', bold: true })] }), 50, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Người phụ trách', bold: true })] }), 22, { isHeader: true }),
                  createBorderedCell(new Paragraph({ children: [new TextRun({ text: 'Thời hạn', bold: true })] }), 18, { isHeader: true }),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('1'), 10),
                  createBorderedCell(new Paragraph('Thu thập phiếu đánh giá (Feedback) từ các Interviewer sau buổi phỏng vấn'), 50),
                  createBorderedCell(new Paragraph('HR Tuyển dụng'), 22),
                  createBorderedCell(new Paragraph('Trong 24h sau phỏng vấn'), 18),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('2'), 10),
                  createBorderedCell(new Paragraph('Gửi thư mời nhận việc (Offer Letter) cho các ứng viên đạt yêu cầu'), 50),
                  createBorderedCell(new Paragraph('HR Manager'), 22),
                  createBorderedCell(new Paragraph('Sau khi có kết quả duyệt'), 18),
                ],
              }),
              new TableRow({
                children: [
                  createBorderedCell(new Paragraph('3'), 10),
                  createBorderedCell(new Paragraph('Tiếp tục mở rộng nguồn ứng viên cho các vị trí trọng điểm'), 50),
                  createBorderedCell(new Paragraph('Talent Acquisition Team'), 22),
                  createBorderedCell(new Paragraph('Tuần tiếp theo'), 18),
                ],
              }),
            ],
          }),

          new Paragraph({ text: '', spacing: { after: 300 } }),

          // MỤC 9: XÁC NHẬN & CHỮ KÝ
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 150 },
            children: [new TextRun({ text: '9. Xác nhận & Phê duyệt', bold: true, size: 24, color: PRIMARY_COLOR })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createBorderedCell(
                    [
                      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NGƯỜI LẬP BÁO CÁO', bold: true })] }),
                      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '(Ký và ghi rõ họ tên)', italics: true, size: 18 })] }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: data.reporterName || 'Họ và tên', bold: true })] }),
                    ],
                    50
                  ),
                  createBorderedCell(
                    [
                      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'NGƯỜI PHÊ DUYỆT', bold: true })] }),
                      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '(Ký, ghi rõ họ tên & đóng dấu)', italics: true, size: 18 })] }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ text: '' }),
                      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Trưởng bộ phận Nhân sự', bold: true })] }),
                    ],
                    50
                  ),
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
