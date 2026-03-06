'use client';

import { useState, useEffect } from 'react';

interface Keyword {
  id: string;
  word: string;
}

export default function KeywordManager() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [newWord, setNewWord] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchKeywords = async () => {
    try {
      const res = await fetch('/api/keywords');
      const data = await res.json();
      if (Array.isArray(data)) setKeywords(data);
    } catch (err) {
      console.error('Failed to fetch keywords:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeywords();
  }, []);

  const addKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newWord.trim()) return;

    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: newWord.trim() }),
      });

      if (res.status === 409) {
        setError('Это ключевое слово уже добавлено');
        return;
      }

      if (res.ok) {
        setNewWord('');
        fetchKeywords();
      }
    } catch (err) {
      console.error('Failed to add keyword:', err);
    }
  };

  const deleteKeyword = async (id: string) => {
    try {
      await fetch('/api/keywords', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchKeywords();
    } catch (err) {
      console.error('Failed to delete keyword:', err);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <h2 className="card-title">Ключевые слова</h2>
        <p className="text-zinc-400">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card-title">Ключевые слова</h2>

      <div className="keyword-list">
        {keywords.map((kw) => (
          <span key={kw.id} className="keyword-tag">
            {kw.word}
            <button
              onClick={() => deleteKeyword(kw.id)}
              className="keyword-delete"
            >
              &times;
            </button>
          </span>
        ))}
      </div>

      <form onSubmit={addKeyword} className="add-form-inline">
        <input
          type="text"
          value={newWord}
          onChange={(e) => {
            setNewWord(e.target.value);
            setError('');
          }}
          placeholder="Новое ключевое слово"
          className="input-field"
        />
        <button type="submit" className="btn-primary">
          Добавить
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
