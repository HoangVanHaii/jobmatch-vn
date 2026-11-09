const fs = require('fs');
const path = require('path');
const {
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
} = require('../frontend/node_modules/docx');

const PRIMARY = '4338CA';
const SECONDARY = '1E293B';
const HEADER_BG = 'F1F5F9';
const BORDER_COLOR = 'CBD5E1';
const TEXT_MUTED = '64748B';

function cell(content, widthPercent, options = {}) {
  const paras = Array.isArray(content) ? content : [content];
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
    children: paras,
  });
}

function headerCell(text, width, align = AlignmentType.LEFT) {
  return cell(
    new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold: true, size: 20, color: '0F172A' })],
    }),
    width,
    { isHeader: true }
  );
}

function dataCell(text, width, options = {}) {
  return cell(
    new Paragraph({
      alignment: options.align || AlignmentType.LEFT,
      children: [
        new TextRun({
          text,
          bold: options.bold,
          italics: options.italics,
          size: 20,
          color: options.color || '334155',
        }),
      ],
    }),
    width,
    options
  );
}

function sectionTitle(title, number) {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text: `${number}. ${title}`,
        bold: true,
        size: 24,
        color: PRIMARY,
      }),
    ],
  });
}

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22, color: SECONDARY },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [
        // 1. BRAND & HEADER
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: 'JOBMATCH VN', bold: true, size: 24, color: PRIMARY }),
            new TextRun({
              text: '  |  Hệ thống nền tảng tuyển dụng thông minh',
              italics: true,
              size: 18,
              color: TEXT_MUTED,
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 200, after: 80 },
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: 'BÁO CÁO TỔNG QUAN PHỎNG VẤN',
              bold: true,
              size: 32,
              color: PRIMARY,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [
            new TextRun({
              text: 'Kỳ báo cáo: [Tuần / Tháng / Quý] ... – ... (Từ ngày [dd/mm/yyyy] đến [dd/mm/yyyy])',
              italics: true,
              size: 20,
              color: TEXT_MUTED,
            }),
          ],
        }),

        // 2. META TABLE
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [headerCell('Thông tin', 30), headerCell('Nội dung', 70)],
            }),
            new TableRow({
              children: [
                dataCell('Hệ thống', 30, { bold: true }),
                dataCell('JobMatch VN – Employer Workspace', 70),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Đơn vị / Doanh nghiệp', 30, { bold: true }),
                dataCell('[Tên công ty / Doanh nghiệp tuyển dụng]', 70, { italics: true }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Người lập báo cáo', 30, { bold: true }),
                dataCell('[Họ và tên – Chức danh / Phòng ban HR]', 70, { italics: true }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Ngày lập báo cáo', 30, { bold: true }),
                dataCell('[dd/mm/yyyy]', 70, { italics: true }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Mã báo cáo', 30, { bold: true }),
                dataCell('[JM-BC-YYYY-MMDD]', 70, { italics: true }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Phiên bản tài liệu', 30, { bold: true }),
                dataCell('1.0 (Chính thức)', 70),
              ],
            }),
          ],
        }),

        // MỤC 1: GIỚI THIỆU
        sectionTitle('Giới thiệu & Mục đích báo cáo', '1'),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: 'Báo cáo này tổng hợp toàn bộ kết quả, tiến độ và chất lượng công tác tổ chức phỏng vấn tuyển dụng trong kỳ. Dữ liệu cung cấp góc nhìn toàn diện cho Ban Giám đốc và Bộ phận Nhân sự (HR) nhằm tối ưu quy trình sàng lọc, đo lường tỷ lệ phân công hội đồng đánh giá và đưa ra các quyết định tuyển dụng chính xác, kịp thời.',
            }),
          ],
        }),

        // MỤC 2: CHỈ SỐ KPI
        sectionTitle('Chỉ số tổng quan (KPIs)', '2'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('Chỉ số KPI', 35),
                headerCell('Giá trị', 25),
                headerCell('Ghi chú / Đánh giá', 40),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Tổng buổi phỏng vấn', 35, { bold: true }),
                dataCell('[...] buổi', 25, { bold: true, color: PRIMARY }),
                dataCell('Tổng số lịch phỏng vấn đã xếp trong kỳ báo cáo', 40),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Số ứng viên tham gia', 35, { bold: true }),
                dataCell('[...] người', 25, { bold: true, color: PRIMARY }),
                dataCell('Số lượng ứng viên độc lập được mời tham dự phỏng vấn', 40),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Tổng thời lượng phỏng vấn', 35, { bold: true }),
                dataCell('[...] giờ [...] phút', 25, { bold: true }),
                dataCell('Tổng quỹ thời gian hội đồng đã dành cho các buổi phỏng vấn', 40),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Tỷ lệ đã xếp hội đồng', 35, { bold: true }),
                dataCell('[...] %', 25, { bold: true, color: '059669' }),
                dataCell('Tỷ lệ buổi PV đã phân công người phỏng vấn / hội đồng cụ thể', 40),
              ],
            }),
          ],
        }),

        // MỤC 3: TÌNH TRẠNG PHỎNG VẤN
        sectionTitle('Tình trạng buổi phỏng vấn', '3'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('Trạng thái', 40),
                headerCell('Số buổi', 30, AlignmentType.CENTER),
                headerCell('Tỷ lệ (%)', 30, AlignmentType.RIGHT),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Đã lên lịch (Scheduled)', 40),
                dataCell('[...]', 30, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 30, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Đang diễn ra (In Progress)', 40),
                dataCell('[...]', 30, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 30, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Hoàn thành (Completed)', 40),
                dataCell('[...]', 30, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 30, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Đã dời lịch (Rescheduled)', 40),
                dataCell('[...]', 30, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 30, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Đã hủy (Cancelled)', 40),
                dataCell('[...]', 30, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 30, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('TỔNG CỘNG', 40, { bold: true }),
                dataCell('[...]', 30, { bold: true, align: AlignmentType.CENTER }),
                dataCell('100%', 30, { bold: true, align: AlignmentType.RIGHT }),
              ],
            }),
          ],
        }),

        // MỤC 4: HÌNH THỨC & LOẠI HÌNH
        sectionTitle('Phân loại hình thức & Loại hình phỏng vấn', '4'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('Loại hình phỏng vấn', 40),
                headerCell('Hình thức (Online/Offline)', 30),
                headerCell('Số buổi', 15, AlignmentType.CENTER),
                headerCell('Tỷ lệ (%)', 15, AlignmentType.RIGHT),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Phỏng vấn Kỹ thuật (Technical)', 40),
                dataCell('Google Meet / Trực tiếp', 30),
                dataCell('[...]', 15, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 15, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Phỏng vấn Văn hóa / Nhân sự (HR)', 40),
                dataCell('Google Meet / Văn phòng', 30),
                dataCell('[...]', 15, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 15, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Phỏng vấn Trực tiếp (Face-to-face)', 40),
                dataCell('Tại văn phòng công ty', 30),
                dataCell('[...]', 15, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 15, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('Live Coding / Bài tập tình huống', 40),
                dataCell('Online Coding Platform', 30),
                dataCell('[...]', 15, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 15, { align: AlignmentType.RIGHT }),
              ],
            }),
          ],
        }),

        // MỤC 5: TOP VỊ TRÍ
        sectionTitle('Top vị trí tuyển dụng có nhiều phỏng vấn nhất', '5'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('STT', 10, AlignmentType.CENTER),
                headerCell('Vị trí tuyển dụng', 50),
                headerCell('Số buổi phỏng vấn', 20, AlignmentType.CENTER),
                headerCell('Tỷ lệ đóng góp', 20, AlignmentType.RIGHT),
              ],
            }),
            new TableRow({
              children: [
                dataCell('1', 10, { align: AlignmentType.CENTER }),
                dataCell('[Ví dụ: Senior Backend Node.js]', 50),
                dataCell('[...]', 20, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 20, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('2', 10, { align: AlignmentType.CENTER }),
                dataCell('[Ví dụ: Frontend Vue.js Developer]', 50),
                dataCell('[...]', 20, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 20, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('3', 10, { align: AlignmentType.CENTER }),
                dataCell('[Ví dụ: UI/UX Product Designer]', 50),
                dataCell('[...]', 20, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 20, { align: AlignmentType.RIGHT }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('4', 10, { align: AlignmentType.CENTER }),
                dataCell('[Ví dụ: AI / ML Engineer]', 50),
                dataCell('[...]', 20, { align: AlignmentType.CENTER }),
                dataCell('[...] %', 20, { align: AlignmentType.RIGHT }),
              ],
            }),
          ],
        }),

        // MỤC 6: DANH SÁCH CHI TIẾT (CÓ CỘT HỘI ĐỒNG & HÌNH THỨC)
        sectionTitle('Danh sách chi tiết các buổi phỏng vấn (Kèm Hội đồng PV)', '6'),
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: '(*) Ghi chú: Cột "Người PV / Hội đồng" theo dõi cán bộ tham gia đánh giá để đảm bảo tỷ lệ hoàn thành đánh giá và tính khách quan.',
              italics: true,
              size: 18,
              color: TEXT_MUTED,
            }),
          ],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('STT', 6, AlignmentType.CENTER),
                headerCell('Ứng viên', 18),
                headerCell('Vị trí ứng tuyển', 20),
                headerCell('Thời gian', 16),
                headerCell('Hình thức', 14),
                headerCell('Người PV / Hội đồng', 16),
                headerCell('Trạng thái', 10, AlignmentType.CENTER),
              ],
            }),
            new TableRow({
              children: [
                dataCell('1', 6, { align: AlignmentType.CENTER }),
                dataCell('[Họ tên ứng viên 1]', 18, { bold: true }),
                dataCell('[Senior Backend Node.js]', 20),
                dataCell('09:00 - 10:00 (13/11/2026)', 16),
                dataCell('Google Meet (Online)', 14),
                dataCell('Nguyễn Văn A (Lead Dev)', 16, { color: PRIMARY }),
                dataCell('Đã lên lịch', 10, { align: AlignmentType.CENTER }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('2', 6, { align: AlignmentType.CENTER }),
                dataCell('[Họ tên ứng viên 2]', 18, { bold: true }),
                dataCell('[Frontend Developer]', 20),
                dataCell('14:30 - 15:30 (13/11/2026)', 16),
                dataCell('Trực tiếp (Phòng họp A)', 14),
                dataCell('Trần Thị B (HR Manager)', 16, { color: PRIMARY }),
                dataCell('Hoàn thành', 10, { align: AlignmentType.CENTER }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('3', 6, { align: AlignmentType.CENTER }),
                dataCell('[Họ tên ứng viên 3]', 18, { bold: true }),
                dataCell('[Product Manager]', 20),
                dataCell('16:00 - 17:00 (14/11/2026)', 16),
                dataCell('Google Meet (Online)', 14),
                dataCell('Chưa chỉ định', 16, { italics: true, color: TEXT_MUTED }),
                dataCell('Đã lên lịch', 10, { align: AlignmentType.CENTER }),
              ],
            }),
          ],
        }),

        // MỤC 7: ĐÁNH GIÁ & NHẬN XÉT
        sectionTitle('Đánh giá & Nhận xét chất lượng phỏng vấn', '7'),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: '• Đánh giá chung: ', bold: true }),
            new TextRun({
              text: '[Nhập nhận xét tổng quan về tiến độ lịch trình, sự hợp tác của các phòng ban chuyên môn và tỷ lệ phản hồi của ứng viên.]',
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: '• Điểm đạt được: ', bold: true, color: '059669' }),
            new TextRun({
              text: '[Ví dụ: Tỷ lệ ứng viên tham gia đúng giờ đạt 95%; 100% ứng viên kỹ thuật được đánh giá qua bài test trước vòng phỏng vấn chuyên sâu.]',
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: '• Tồn tại / Thách thức: ', bold: true, color: 'DC2626' }),
            new TextRun({
              text: '[Ví dụ: Một số buổi phỏng vấn kỹ thuật còn bị dời lịch do người phỏng vấn bận dự án đột xuất; cần bổ sung interviewer dự phòng.]',
            }),
          ],
        }),

        // MỤC 8: ĐỀ XUẤT HÀNH ĐỘNG
        sectionTitle('Đề xuất & Kế hoạch hành động tiếp theo', '8'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('STT', 10, AlignmentType.CENTER),
                headerCell('Nội dung đề xuất / Hành động', 45),
                headerCell('Người phụ trách', 25),
                headerCell('Thời hạn', 20, AlignmentType.CENTER),
              ],
            }),
            new TableRow({
              children: [
                dataCell('1', 10, { align: AlignmentType.CENTER }),
                dataCell('Chốt kết quả vòng 2 và gửi Offer cho các ứng viên đạt yêu cầu', 45),
                dataCell('Phòng Tuyển dụng (HR)', 25),
                dataCell('[dd/mm/yyyy]', 20, { align: AlignmentType.CENTER }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('2', 10, { align: AlignmentType.CENTER }),
                dataCell('Mở đợt phỏng vấn bổ sung cho vị trí còn thiếu quota', 45),
                dataCell('Lead Recruiter', 25),
                dataCell('[dd/mm/yyyy]', 20, { align: AlignmentType.CENTER }),
              ],
            }),
            new TableRow({
              children: [
                dataCell('3', 10, { align: AlignmentType.CENTER }),
                dataCell('Tối ưu hóa thời gian trả kết quả phỏng vấn dưới 48 giờ', 45),
                dataCell('Hội đồng phỏng vấn', 25),
                dataCell('[dd/mm/yyyy]', 20, { align: AlignmentType.CENTER }),
              ],
            }),
          ],
        }),

        // MỤC 9: CHỮ KÝ
        sectionTitle('Xác nhận & Phê duyệt', '9'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: 'NGƯỜI LẬP BÁO CÁO', bold: true })],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: '(Ký và ghi rõ họ tên)',
                          italics: true,
                          size: 18,
                        }),
                      ],
                    }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: '[Họ và tên người lập]', bold: true })],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: 'Chuyên viên Tuyển dụng',
                          size: 18,
                          color: TEXT_MUTED,
                        }),
                      ],
                    }),
                  ],
                  50
                ),
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: 'NGƯỜI PHÊ DUYỆT', bold: true })],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: '(Ký, ghi rõ họ tên & đóng dấu)',
                          italics: true,
                          size: 18,
                        }),
                      ],
                    }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({ text: '' }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: '[Họ và tên người duyệt]', bold: true })],
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: 'Trưởng bộ phận Nhân sự / HR Director',
                          size: 18,
                          color: TEXT_MUTED,
                        }),
                      ],
                    }),
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

async function main() {
  const buffer = await Packer.toBuffer(doc);

  // 1. Lưu vào thư mục frontend/public/templates
  const outDirPublic = path.resolve(__dirname, '../frontend/public/templates');
  if (!fs.existsSync(outDirPublic)) fs.mkdirSync(outDirPublic, { recursive: true });
  const outPublic = path.join(outDirPublic, 'JobMatchVN_Mau_Bao_cao_Phong_van.docx');
  fs.writeFileSync(outPublic, buffer);
  console.log('Saved to public templates:', outPublic);

  // 2. Lưu vào thư mục docs/templates
  const outDirDocs = path.resolve(__dirname, '../docs/templates');
  if (!fs.existsSync(outDirDocs)) fs.mkdirSync(outDirDocs, { recursive: true });
  const outDocs = path.join(outDirDocs, 'JobMatchVN_Mau_Bao_cao_Phong_van.docx');
  fs.writeFileSync(outDocs, buffer);
  console.log('Saved to docs templates:', outDocs);

  // 3. Lưu vào Artifact directory
  const artifactDir = 'C:/Users/hp/.gemini/antigravity/brain/6e8b94d8-efaf-4b5f-9d8f-6da6997e558e';
  if (fs.existsSync(artifactDir)) {
    const outArtifact = path.join(artifactDir, 'JobMatchVN_Mau_Bao_cao_Phong_van_Chuan.docx');
    fs.writeFileSync(outArtifact, buffer);
    console.log('Saved to artifact:', outArtifact);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

