import { describe, expect, it } from 'vitest';
import { FORECAST_MODEL, forecastUrl, parseForecast, parseForecasts } from './forecast';

describe('forecastUrl', () => {
  it('asks for the rounded cell, the fixed model and Amsterdam time', () => {
    const url = new URL(forecastUrl({ lat: 52.38, lon: 4.905 }));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('52.38');
    expect(url.searchParams.get('longitude')).toBe('4.905');
    expect(url.searchParams.get('models')).toBe(FORECAST_MODEL);
    expect(url.searchParams.get('timezone')).toBe('Europe/Amsterdam');
    expect(url.searchParams.get('hourly')).toBe(
      'precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    );
  });

  it('asks for several cells in one request with exactly the same other parameters', () => {
    const one = new URL(forecastUrl({ lat: 52.38, lon: 4.905 }));
    const many = new URL(
      forecastUrl([
        { lat: 52.38, lon: 4.905 },
        { lat: 52.09, lon: 5.12 },
      ]),
    );
    expect(many.searchParams.get('latitude')).toBe('52.38,52.09');
    expect(many.searchParams.get('longitude')).toBe('4.905,5.12');
    for (const key of ['hourly', 'models', 'timezone', 'forecast_days', 'wind_speed_unit'])
      expect(many.searchParams.get(key)).toBe(one.searchParams.get(key));
    expect(forecastUrl([{ lat: 52.38, lon: 4.905 }])).toBe(forecastUrl({ lat: 52.38, lon: 4.905 }));
  });
});

describe('parseForecasts', () => {
  const location = {
    hourly: {
      time: ['2026-10-23T07:00'],
      precipitation_probability: [10],
      precipitation: [0],
      wind_speed_10m: [12],
      wind_direction_10m: [250],
      wind_gusts_10m: [30],
    },
  };
  it('reads an array in request order, and a single object for one cell', () => {
    const [a, b] = parseForecasts([location, { error: true }], 2)!;
    expect(a).toHaveLength(1);
    expect(b).toBeNull();
    expect(parseForecasts(location, 1)![0]).toHaveLength(1);
  });
  it('is null when the count does not match', () => {
    expect(parseForecasts([location], 2)).toBeNull();
  });
});

describe('parseForecast', () => {
  const body = {
    hourly: {
      time: ['2026-10-20T07:00', '2026-10-20T08:00', '2026-10-20T09:00'],
      precipitation_probability: [10, null, 30],
      precipitation: [0, 0.1, 0.4],
      wind_speed_10m: [12.5, 14, 16],
      wind_direction_10m: [240, 250, 260],
      wind_gusts_10m: [25, 28, 33],
    },
  };

  it('maps columns to hours and drops hours with a missing value', () => {
    expect(parseForecast(body)).toEqual([
      {
        date: '2026-10-20',
        minute: 420,
        precipProb: 10,
        precipMm: 0,
        windSpeed: 12.5,
        windFrom: 240,
        gust: 25,
      },
      {
        date: '2026-10-20',
        minute: 540,
        precipProb: 30,
        precipMm: 0.4,
        windSpeed: 16,
        windFrom: 260,
        gust: 33,
      },
    ]);
  });

  it.each([
    ['null', null],
    ['no hourly', { latitude: 52 }],
    ['no time', { hourly: {} }],
    ['a short column', { hourly: { ...body.hourly, precipitation: [0] } }],
  ])('rejects %s', (_label, value) => {
    expect(parseForecast(value)).toBeNull();
  });

  it('skips malformed timestamps', () => {
    const bad = { hourly: { ...body.hourly, time: ['tomorrow', '2026-10-20T08:00', '2026-10-20T09:00'] } };
    expect(parseForecast(bad)?.map((h) => h.minute)).toEqual([540]);
  });
});
