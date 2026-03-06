'use client';

import { useState, useEffect } from 'react';

interface SearchResult {
  id: string;
  sourceUrl: string;
  sourceName: string;
  title: string;
  description: string;
  link: string;
  matchedKeywords: string;
  foundAt: string;
  sessionId: string;
}

interface ResultsViewProps {
  refreshTrigger: number;
}

export default function ResultsView({ refreshTrigger }: ResultsViewProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchResults = async () => {
    try {
      const res = await fetch('/api/results');
      const data = await res.json();
      if (Array.isArray(data)) setResults(data);
    } catch (err) {
      console.error('Failed to fetch results:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, [refreshTrigger]);

  const clearResults = async () => {
    if (!confirm('Удалить все результаты?')) return;
    try {
      await fetch('/api/results', { method: 'DELETE' });
      setResults([]);
    } catch (err) {
      console.error('Failed to clear results:', err);
    }
  };

  const exportResults = async (format: 'xlsx' | 'docx') => {
    setExporting(true);
    try {
      const res = await fetch(`/api/export?format=${format}`);
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Ошибка экспорта');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Ошибка при экспорте');
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="card results-card">
      <div className="results-header">
        <h2 className="card-title">
          Результаты поиска
          {results.length > 0 && (
            <span className="results-count">{results.length}</span>
          )}
        </h2>
        <div className="results-actions">
          <button
            onClick={() => exportResults('xlsx')}
            disabled={exporting || results.length === 0}
            className="btn-export"
          >
            {exporting ? '...' : 'Excel (.xlsx)'}
          </button>
          <button
            onClick={() => exportResults('docx')}
            disabled={exporting || results.length === 0}
            className="btn-export"
          >
            {exporting ? '...' : 'Word (.docx)'}
          </button>
          <button
            onClick={clearResults}
            disabled={results.length === 0}
            className="btn-danger"
          >
            Очистить
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-400">Загрузка результатов...</p>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <p>Результатов пока нет.</p>
          <p className="text-sm">
            Нажмите &quot;Запустить поиск&quot; для сканирования источников.
          </p>
        </div>
      ) : (
        <div className="results-table-wrapper">
          <table className="results-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Источник</th>
                <th>Название</th>
                <th>Ключевые слова</th>
                <th>Ссылка</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, index) => (
                <tr key={result.id}>
                  <td>{index + 1}</td>
                  <td>{result.sourceName}</td>
                  <td className="result-title" title={result.description}>
                    {result.title}
                  </td>
                  <td>
                    <div className="keyword-matches">
                      {result.matchedKeywords
                        .split(', ')
                        .filter(Boolean)
                        .map((kw, i) => (
                          <span key={i} className="keyword-match">
                            {kw}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td>
                    {result.link ? (
                      <a
                        href={result.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="result-link"
                      >
                        Открыть
                      </a>
                    ) : (
                      <span className="text-zinc-500">-</span>
                    )}
                  </td>
                  <td className="result-date">
                    {formatDate(result.foundAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
