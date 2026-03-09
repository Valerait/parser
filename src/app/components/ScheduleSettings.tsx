'use client';

import { useState, useEffect } from 'react';

const DAYS = [
  { value: 1, short: 'Пн' },
  { value: 2, short: 'Вт' },
  { value: 3, short: 'Ср' },
  { value: 4, short: 'Чт' },
  { value: 5, short: 'Пт' },
  { value: 6, short: 'Сб' },
  { value: 0, short: 'Вс' },
];

export default function ScheduleSettings() {
  const [time, setTime] = useState('09:00');
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const res = await fetch('/api/schedule');
        const data = await res.json();
        if (data.scheduleTime) setTime(data.scheduleTime);
        if (data.scheduleEnabled !== undefined) setEnabled(data.scheduleEnabled);
        if (data.scheduleDays) {
          const parsed = data.scheduleDays
            .split(',')
            .map(Number)
            .filter((n: number) => !isNaN(n));
          if (parsed.length > 0) setDays(parsed);
        }
      } catch (err) {
        console.error('Failed to fetch schedule:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSchedule();
  }, []);

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const saveSchedule = async () => {
    try {
      await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleTime: time,
          scheduleEnabled: enabled,
          scheduleDays: days.sort((a, b) => a - b).join(','),
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Дни недели:</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {DAYS.map((d) => {
            const active = days.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                style={{
                  width: 36,
                  height: 32,
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6,
                  background: active ? 'var(--accent)' : 'var(--bg-input)',
                  color: active ? '#fff' : 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {d.short}
              </button>
            );
          })}
        </div>
      </div>

      <p className="schedule-hint">
        Для работы расписания локально запустите:{' '}
        <code>npm run scheduler</code>
      </p>
    </div>
  );
}
