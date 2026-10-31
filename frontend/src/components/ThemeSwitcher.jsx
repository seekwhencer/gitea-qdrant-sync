import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gitea-search:theme';
const MODES = ['auto', 'light', 'dark'];

const LABELS = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

const DEFAULT_MODE = 'dark';

function readStoredMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && MODES.includes(stored)) return stored;
  } catch (_) {}
  return DEFAULT_MODE;
}

function applyMode(mode) {
  document.documentElement.setAttribute('data-theme', mode);
}

function AutoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function DarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const ICONS = {
  auto: AutoIcon,
  light: LightIcon,
  dark: DarkIcon,
};

export default function ThemeSwitcher() {
  const [mode, setMode] = useState(readStoredMode);

  useEffect(() => {
    applyMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (_) {}
  }, [mode]);

  return (
    <div className="theme-switcher" role="group" aria-label="Color theme">
      {MODES.map((m) => {
        const Icon = ICONS[m];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            className={`theme-switcher__option${active ? ' theme-switcher__option--active' : ''}`}
            aria-pressed={active}
            title={`${LABELS[m]} theme`}
            onClick={() => setMode(m)}
          >
            <span className="theme-switcher__icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="theme-switcher__label">{LABELS[m]}</span>
          </button>
        );
      })}
    </div>
  );
}
