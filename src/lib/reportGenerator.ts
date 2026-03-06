import ExcelJS from 'exceljs';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ExternalHyperlink,
} from 'docx';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface ResultRow {
  id: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  description: string;
  link: string;
  matchedKeywords: string;
  foundAt: Date | string;
}

export async function generateExcel(results: ResultRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Результаты поиска');

  sheet.columns = [
    { header: '№', key: 'num', width: 6 },
    { header: 'Источник', key: 'source', width: 25 },
    { header: 'Название', key: 'title', width: 50 },
    { header: 'Описание', key: 'description', width: 60 },
    { header: 'Ссылка на объявление', key: 'link', width: 45 },
    { header: 'Ключевые слова', key: 'keywords', width: 30 },
    { header: 'Дата', key: 'date', width: 20 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  results.forEach((result, index) => {
    const rowNum = index + 2; // rows start at 2 (1 is header)
    sheet.addRow({
      num: index + 1,
      source: result.sourceName,
      title: result.title,
      description: result.description,
      link: result.link || '',
      keywords: result.matchedKeywords,
      date: format(new Date(result.foundAt), 'dd.MM.yyyy HH:mm', {
        locale: ru,
      }),
    });

    // Make link cell a clickable hyperlink
    if (result.link) {
      const linkCell = sheet.getCell(rowNum, 5);
      linkCell.value = {
        text: result.link,
        hyperlink: result.link,
      };
      linkCell.font = { color: { argb: 'FF2563EB' }, underline: true };
    }
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: 'top', wrapText: true };
    }
    row.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateWord(results: ResultRow[]): Promise<Buffer> {
  const now = format(new Date(), 'dd.MM.yyyy HH:mm', { locale: ru });

  const children: Paragraph[] = [
    new Paragraph({
      text: 'Отчет о найденных объявлениях',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Дата формирования: ${now}`,
          size: 22,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Всего найдено: ${results.length} объявлений`,
          bold: true,
          size: 24,
        }),
      ],
      spacing: { after: 400 },
    }),
  ];

  results.forEach((result, index) => {
    const linkParagraph = result.link
      ? new Paragraph({
          children: [
            new TextRun({ text: 'Ссылка: ', bold: true }),
            new ExternalHyperlink({
              link: result.link,
              children: [
                new TextRun({
                  text: result.link,
                  style: 'Hyperlink',
                }),
              ],
            }),
          ],
        })
      : new Paragraph({
          children: [
            new TextRun({ text: 'Ссылка: ', bold: true }),
            new TextRun({ text: 'Нет ссылки' }),
          ],
        });

    children.push(
      new Paragraph({
        text: `${index + 1}. ${result.title}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300 },
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'Источник: ', bold: true }),
          new TextRun({ text: result.sourceName }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'URL источника: ', bold: true }),
          new TextRun({ text: result.sourceUrl }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'Описание: ', bold: true }),
          new TextRun({ text: result.description || 'Нет описания' }),
        ],
      }),
      linkParagraph,
      new Paragraph({
        children: [
          new TextRun({ text: 'Ключевые слова: ', bold: true }),
          new TextRun({ text: result.matchedKeywords || 'Нет' }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'Найдено: ', bold: true }),
          new TextRun({
            text: format(new Date(result.foundAt), 'dd.MM.yyyy HH:mm', {
              locale: ru,
            }),
          }),
        ],
        spacing: { after: 200 },
      }),
      new Paragraph({
        text: '\u2500'.repeat(60),
        spacing: { after: 200 },
      })
    );
  });

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
