import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useThemeStore } from '../../stores/theme';
import { NAV } from '../../config/novaSolutions';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 12.3A9 9 0 1111.7 3a7 7 0 009.3 9.3z" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function NavDropdown({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, []);

  return (
    <div className="nv-nav-item" ref={ref}>
      <button type="button" className="nv-nav-link" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        {label} <ChevronIcon />
      </button>
      {open && (
        <div className="nv-dropdown" role="menu">
          {items.map(item => (
            <Link key={item.label} to={item.href} role="menuitem" onClick={() => setOpen(false)}>{item.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { theme, toggle } = useThemeStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="nv-header">
      <div className="nv-header-inner">
        <Link to="/" className="nv-logo" onClick={() => setMobileOpen(false)}>
          <span className="nv-logo-mark">N</span>
          Nova Solutions
        </Link>

        <nav className="nv-nav" aria-label="Primary">
          {NAV.map(item => item.items
            ? <NavDropdown key={item.label} label={item.label} items={item.items} />
            : <Link key={item.label} to={item.href} className="nv-nav-link">{item.label}</Link>
          )}
        </nav>

        <div className="nv-header-actions">
          <button
            type="button"
            className="nv-theme-btn"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link to="/contact" className="nv-btn nv-btn-primary nv-btn-sm nv-header-cta">
            Book a Consultation <ArrowIcon />
          </Link>
          <button
            type="button"
            className="nv-menu-btn"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(o => !o)}
          >
            <MenuIcon />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="nv-mobile-menu">
          {NAV.map(item => (
            <div className="nv-mobile-group" key={item.label}>
              {item.items ? (
                <>
                  <div className="nv-mobile-group-title">{item.label}</div>
                  {item.items.map(sub => (
                    <Link key={sub.label} to={sub.href} onClick={() => setMobileOpen(false)}>{sub.label}</Link>
                  ))}
                </>
              ) : (
                <Link to={item.href} onClick={() => setMobileOpen(false)}>{item.label}</Link>
              )}
            </div>
          ))}
          <Link to="/contact" className="nv-btn nv-btn-primary nv-mobile-cta" onClick={() => setMobileOpen(false)}>
            Book a Consultation <ArrowIcon />
          </Link>
        </div>
      )}
    </header>
  );
}
