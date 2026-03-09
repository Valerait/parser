'use client';

import { useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import SourceManager from './components/SourceManager';
import KeywordManager from './components/KeywordManager';
import ScheduleSettings from './components/ScheduleSettings';
import ResultsView from './components/ResultsView';

export default function Dashboard() {
  const { data: session } = useSession();
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
      <header className="app-header" style={{ position: 'relative' }}>
        <h1>Parser App</h1>
        <p>Мониторинг объявлений и тендеров</p>
        {session?.user && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>
              {session.user.email}
            </span>
            <button
              onClick={() => signOut()}
              style={{
                padding: '6px 14px',
                background: 'transparent',
                color: '#ef4444',
                border: '1px solid #ef4444',
                borderRadius: 8,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Выйти
            </button>
          </div>
        )}
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
