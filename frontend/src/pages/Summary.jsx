import { useQuery } from '@tanstack/react-query';
import { useAuthStore, isSuperAdmin } from '../stores/auth';
import Layout from '../components/Layout';
import Spinner from '../components/ui/Spinner';
import api from '../lib/api';

const ANIM = `
  @keyframes sv-dot1{0%,80%,100%{opacity:.15}20%,40%{opacity:1}}
  @keyframes sv-dot2{0%,20%,100%{opacity:.15}40%,60%{opacity:1}}
  @keyframes sv-dot3{0%,40%,100%{opacity:.15}60%,80%{opacity:1}}
  @keyframes sv-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
  @keyframes sv-blink{0%,100%{opacity:1}50%{opacity:.15}}
  @keyframes sv-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes sv-ripple{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.6);opacity:0}}
  @keyframes sv-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.12);opacity:1}}
  @keyframes sv-bar1{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}
  @keyframes sv-bar2{0%,100%{transform:scaleY(.65)}50%{transform:scaleY(1)}}
  @keyframes sv-bar3{0%,100%{transform:scaleY(.2)}50%{transform:scaleY(.82)}}
`;

/* Chat bubble with staggered typing dots */
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <path d="M2 5a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H7l-5 4V5z"
        fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="7.5" cy="10" r="1.3" fill="currentColor" style={{animation:'sv-dot1 1.6s ease-in-out infinite'}}/>
      <circle cx="12"  cy="10" r="1.3" fill="currentColor" style={{animation:'sv-dot2 1.6s ease-in-out infinite'}}/>
      <circle cx="16.5" cy="10" r="1.3" fill="currentColor" style={{animation:'sv-dot3 1.6s ease-in-out infinite'}}/>
    </svg>
  );
}

/* Package box with floating lid */
function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <rect x="3" y="9" width="18" height="12" rx="1.5" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M3 9l9-5 9 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
        style={{animation:'sv-float 2s ease-in-out infinite', transformOrigin:'12px 6.5px'}}/>
      <path d="M9 9v5h6V9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  );
}

/* Calendar with blinking date cell */
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="2" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="14" y="13" width="4" height="3.5" rx="0.8" fill="currentColor"
        style={{animation:'sv-blink 2.2s ease-in-out infinite'}}/>
    </svg>
  );
}

/* Stacked layers floating */
function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
      style={{animation:'sv-float 2.5s ease-in-out infinite'}}>
      <rect x="4" y="15.5" width="16" height="3.5" rx="1.5" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="4" y="10.5" width="16" height="3.5" rx="1.5" fill="currentColor" opacity="0.32" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="4" y="5.5"  width="16" height="3.5" rx="1.5" fill="currentColor" opacity="0.55" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  );
}

/* Analog clock with spinning hands */
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="12" y1="12" x2="12" y2="5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        style={{animation:'sv-spin 10s linear infinite', transformOrigin:'12px 12px'}}/>
      <line x1="12" y1="12" x2="16.5" y2="13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        style={{animation:'sv-spin 120s linear infinite', transformOrigin:'12px 12px'}}/>
      <circle cx="12" cy="12" r="1.3" fill="currentColor"/>
    </svg>
  );
}

/* Two people with expanding ripple ring */
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <circle cx="9" cy="7" r="3.5" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="9" cy="7" r="3.5" fill="none" stroke="currentColor" strokeWidth="0.8"
        style={{animation:'sv-ripple 2s ease-out infinite', transformBox:'fill-box', transformOrigin:'center'}}/>
      <path d="M2 21c0-3.3 2.7-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="18" cy="8" r="2.5" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M20.5 21c0-2.2-1.4-4-3.5-4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

/* Nova sparkle — 4-pointed star pulsing with small accent sparkle */
function NovaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <path d="M12 3c0 0 2 5.5 6.5 7C14 11.5 12 17 12 17S10 11.5 5.5 10C10 8.5 12 3 12 3z"
        fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
        style={{animation:'sv-pulse 2.5s ease-in-out infinite', transformOrigin:'12px 10px'}}/>
      <path d="M19 4c0 0 .9 2.4 2.8 3-1.9.6-2.8 3-2.8 3s-.9-2.4-2.8-3c1.9-.6 2.8-3 2.8-3z"
        fill="currentColor" opacity="0.55"
        style={{animation:'sv-pulse 2.5s ease-in-out infinite', animationDelay:'0.9s', transformOrigin:'19px 7px'}}/>
    </svg>
  );
}

/* Bar chart with animated rising bars */
function CostIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
      <rect x="3"    y="11" width="4.5" height="10" rx="1" fill="currentColor" opacity="0.45"
        style={{animation:'sv-bar1 2.4s ease-in-out infinite', transformOrigin:'5.25px 21px'}}/>
      <rect x="9.75" y="5"  width="4.5" height="16" rx="1" fill="currentColor" opacity="0.65"
        style={{animation:'sv-bar2 2.4s ease-in-out infinite', animationDelay:'0.35s', transformOrigin:'12px 21px'}}/>
      <rect x="16.5" y="9"  width="4.5" height="12" rx="1" fill="currentColor" opacity="0.45"
        style={{animation:'sv-bar3 2.4s ease-in-out infinite', animationDelay:'0.7s', transformOrigin:'18.75px 21px'}}/>
      <path d="M2 21h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

const StatCard = ({ Icon, iconColor, label, value, sub, accent }) => (
  <div
    className="rounded-2xl p-5 flex flex-col gap-2"
    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
  >
    <div className="flex items-center justify-between w-full">
      <span style={{ color: iconColor || 'var(--text-2)' }}><Icon /></span>
      {sub && (
        <span
          className="text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--text-1)' }}
        >{sub}</span>
      )}
    </div>
    <div className="text-2xl font-bold mt-1" style={{ color: accent || 'var(--text-1)' }}>{value}</div>
    <div className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{label}</div>
  </div>
);

export default function Summary() {
  const { user, selectedClientId } = useAuthStore();
  const superAdmin = isSuperAdmin(user);
  const clientId = superAdmin ? (selectedClientId || null) : user?.clientId;

  const { data, isLoading } = useQuery({
    queryKey: ['summary', clientId],
    queryFn: () => api.get('/summary', { params: clientId ? { client_id: clientId } : {} }).then(r => r.data),
    refetchInterval: 60_000,
  });

  const n   = (v) => (v == null ? '-' : Number(v).toLocaleString());
  const usd = (v) => (v == null ? '-' : `$${parseFloat(v).toFixed(4)}`);

  return (
    <Layout>
      <style>{ANIM}</style>
      <div className="flex flex-col h-full">
        <div
          className="px-6 py-4 shrink-0 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>Summary</h1>
          <span className="text-xs ml-1" style={{ color: 'var(--text-3)' }}>Live stats for your account</span>
        </div>

        <div className="flex-1 overflow-auto px-6 py-6">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
              <StatCard Icon={ChatIcon}     iconColor="var(--accent)" label="New Chats Today"        value={n(data?.new_chats_today)}        sub="24h"   accent="var(--accent)" />
              <StatCard Icon={BoxIcon}      iconColor="var(--accent)" label="Orders Today"            value={n(data?.orders_today)}           sub="24h"   accent="var(--accent)" />
              <StatCard Icon={CalendarIcon} iconColor="var(--accent)" label="Orders This Month"       value={n(data?.orders_this_month)}      sub="month" />
              <StatCard Icon={LayersIcon}                             label="Total Orders"            value={n(data?.orders_total)} />
              <StatCard Icon={ClockIcon}    iconColor="#fbbf24"       label="Open Orders"             value={n(data?.open_orders)}            accent="#fbbf24" />
              <StatCard Icon={UsersIcon}                              label="Total Customers"         value={n(data?.total_customers)} />
              <StatCard Icon={NovaIcon}     iconColor="#34d399"       label="Nova Replies Today"      value={n(data?.ai_messages_today)}      sub="24h"   accent="#34d399" />
              <StatCard Icon={NovaIcon}     iconColor="#34d399"       label="Nova Replies This Month" value={n(data?.ai_messages_this_month)} sub="month" accent="#34d399" />
              <StatCard Icon={NovaIcon}     iconColor="#34d399"       label="Nova Replies Total"      value={n(data?.ai_messages_total)}                  accent="#34d399" />
              <StatCard Icon={CostIcon}     iconColor="#a78bfa"       label="Nova Cost Today"         value={usd(data?.cost_today)}           sub="24h"   accent="#a78bfa" />
              <StatCard Icon={CostIcon}     iconColor="#a78bfa"       label="Nova Cost This Month"    value={usd(data?.cost_this_month)}      sub="month" accent="#a78bfa" />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
