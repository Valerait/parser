'use client';

import { useState, useEffect } from 'react';

export default function ScheduleSettings() {
  const [time, setTime] = useState('09:00');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const res = await fetch('/api/schedule');
        const data = await res.json();
        if (data.scheduleTime) setTime(data.scheduleTime);
        if (data.scheduleEnabled !== undefined) setEnabled(data.scheduleEnabled);
      } catch (err) {
        console.error('Failed to fetch schedule:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSchedule();
  }, []);

  const saveSchedule = async () => {
    try {
      await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleTime: time,
          scheduleEnabled: enabled,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save schedule:', err);
    }
  };

  if (loading) {
    return <p className="text-zinc-400">Загрузка расписания...</p>;
  }

  return (
    <div className="schedule-section">
      <h3 className="schedule-title">Расписание автопоиска</h3>
      <div className="schedule-controls">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="toggle-checkbox"
          />
          <span>{enabled ? 'Включено' : 'Выключено'}</span>
        </label>

        <div className="time-picker">
          <label htmlFor="schedule-time">Время запуска:</label>
          <input
            id="schedule-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="input-time"
          />
        </div>

        <button onClick={saveSchedule} className="btn-secondary">
          {saved ? 'Сохранено!' : 'Сохранить расписание'}
        </button>
      </div>
      <p className="schedule-hint">
        Для работы расписания локально запустите:{' '}
        <code>npm run scheduler</code>
      </p>
    </div>
  );
}
