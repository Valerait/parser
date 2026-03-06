'use client';

import { useState, useEffect } from 'react';

interface Source {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export default function SourceManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      if (Array.isArray(data)) setSources(data);
    } catch (err) {
      console.error('Failed to fetch sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) return;

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() }),
      });
      if (res.ok) {
        setNewName('');
        setNewUrl('');
        fetchSources();
      }
    } catch (err) {
      console.error('Failed to add source:', err);
    }
  };

  const toggleSource = async (id: string, enabled: boolean) => {
    try {
      await fetch('/api/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: !enabled }),
      });
      fetchSources();
    } catch (err) {
      console.error('Failed to toggle source:', err);
    }
  };

  const deleteSource = async (id: string) => {
    try {
      await fetch('/api/sources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchSources();
    } catch (err) {
      console.error('Failed to delete source:', err);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h2 className="card-title">Источники</h2>
        <p className="text-zinc-400">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card-title">Источники (сайты для поиска)</h2>

      <div className="source-list">
        {sources.map((source) => (
          <div
            key={source.id}
            className={`source-item ${!source.enabled ? 'opacity-50' : ''}`}
          >
            <div className="source-info">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={() => toggleSource(source.id, source.enabled)}
                  className="toggle-checkbox"
                />
                <span className="source-name">{source.name}</span>
              </label>
              <span className="source-url">{source.url}</span>
            </div>
            <button
              onClick={() => deleteSource(source.id)}
              className="btn-delete"
              title="Удалить"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={addSource} className="add-form">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Название источника"
          className="input-field"
        />
        <input
          type="text"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="URL (например: https://example.kz)"
          className="input-field"
        />
        <button type="submit" className="btn-primary">
          Добавить
        </button>
      </form>
    </div>
  );
}
