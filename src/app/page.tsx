'use client';

import { useState } from 'react';
import SourceManager from './components/SourceManager';
import KeywordManager from './components/KeywordManager';
import ScheduleSettings from './components/ScheduleSettings';
import ResultsView from './components/ResultsView';

export default function Dashboard() {
  const [isSearching, setIsSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchMessageType, setSearchMessageType] = useState<
    'success' | 'error' | ''
  >('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchMessage('');
    setSearchMessageType('');

    try {
      const res = await fetch('/api/search', { method: 'POST' });
      const data = await res.json();

      if (!res.ok || data.error) {
        setSearchMessage(data.error || 'Ошибка при поиске');
        setSearchMessageType('error');
      } else {
        const msg = `Найдено ${data.count} объявлений`;
        const errMsg =
          data.errors?.length > 0
            ? `. Ошибки: ${data.errors.length}`
            : '';
        setSearchMessage(msg + errMsg);
        setSearchMessageType('success');
        setRefreshTrigger((prev) => prev + 1);
      }
    } catch {
      setSearchMessage('Ошибка сети при выполнении поиска');
      setSearchMessageType('error');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Parser App</h1>
        <p>Мониторинг объявлений и тендеров</p>
      </header>

      <div className="grid-2">
        <SourceManager />
        <KeywordManager />
      </div>

      <div className="search-section">
        <ScheduleSettings />
        <button
          onClick={handleSearch}
          disabled={isSearching}
          className="btn-search"
        >
          {isSearching && <span className="spinner" />}
          {isSearching ? 'Поиск...' : 'Запустить поиск'}
        </button>
        {searchMessage && (
          <span className={`search-message ${searchMessageType}`}>
            {searchMessage}
          </span>
        )}
      </div>

      <ResultsView refreshTrigger={refreshTrigger} />
    </div>
  );
}
