import { useEffect, useRef, useState } from 'react';

const SUPPORTS_OBSERVER = typeof IntersectionObserver !== 'undefined';

/**
 * Scroll-reveal wrapper. `stagger` reveals direct children in sequence
 * instead of fading the whole block in at once.
 */
// `Tag` is used as a dynamic JSX tag below; this project's eslint config has no
// eslint-plugin-react installed, so the base no-unused-vars rule can't see that usage.
// eslint-disable-next-line no-unused-vars
export default function Reveal({ as: Tag = 'div', className = '', stagger = false, children, ...rest }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => !SUPPORTS_OBSERVER);

  useEffect(() => {
    const el = ref.current;
    if (!el || !SUPPORTS_OBSERVER) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const base = stagger ? 'nv-reveal-stagger' : 'nv-reveal';
  const cls = [base, visible ? 'nv-reveal-visible' : '', className].filter(Boolean).join(' ');
  return (
    <Tag ref={ref} className={cls} {...rest}>
      {children}
    </Tag>
  );
}
