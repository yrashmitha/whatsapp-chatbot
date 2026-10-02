import { useState, useEffect } from 'react';

/**
 * True on a laptop screen or larger. Used where a wide screen can show in the
 * open what a narrow one keeps behind a click.
 */
export default function useIsWide(query = '(min-width: 1280px)') {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}
