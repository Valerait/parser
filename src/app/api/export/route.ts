import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateExcel, generateWord } from '@/lib/reportGenerator';

export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get('format') || 'xlsx';

    const { data: results, error } = await supabase
      .from('SearchResult')
      .select('*')
      .order('foundAt', { ascending: false });

    if (error) throw error;

    if (!results || results.length === 0) {
      return NextResponse.json(
        { error: 'Нет результатов для экспорта' },
        { status: 404 }
      );
    }

    if (format === 'docx') {
      const buffer = await generateWord(results);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="report_${Date.now()}.docx"`,
        },
      });
    }

    const buffer = await generateExcel(results);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="report_${Date.now()}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('GET /api/export error:', error);
    return NextResponse.json(
      { error: 'Ошибка при создании отчета' },
      { status: 500 }
    );
  }
}
