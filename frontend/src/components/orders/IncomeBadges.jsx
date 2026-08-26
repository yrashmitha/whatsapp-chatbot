const money = (n) => 'LKR ' + Math.round(Number(n) || 0).toLocaleString();

/**
 * One badge. Kept local because these differ only by colour and title.
 */
function Badge({ tone = 'slate', title, children, onClick }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    violet:  'bg-violet-50 text-violet-700 border-violet-200',
    slate:   'bg-slate-50 text-slate-600 border-slate-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border ${tones[tone]} ${onClick ? 'hover:brightness-95 cursor-pointer' : ''}`}
    >
      {children}
    </Tag>
  );
}

/**
 * What this month brought in, answered for whoever is looking.
 *
 * Three shapes, because three different questions are being asked. An operator
 * sees what they sold. The owner sees the split, or - once they filter to one
 * person - what that person sold and what they are owed on it.
 *
 * @param {Object}   props
 * @param {Object}   props.income     - the income-summary payload
 * @param {string}   props.operator   - the current filter: '', 'bot', or a user id
 * @param {Function} props.onPick     - set the filter, so a badge doubles as one
 */
export default function IncomeBadges({ income, operator, onPick }) {
  if (!income) return null;

  // An operator looking at their own figures.
  if (income.scope === 'own') {
    return (
      <Badge tone="emerald" title={`${income.order_count} sale${income.order_count === 1 ? '' : 's'} credited to you this month`}>
        💰 My sales: {money(income.total)}
        <span className="opacity-60">({income.order_count})</span>
      </Badge>
    );
  }

  // The owner, filtered to the bot's unattended sales.
  if (income.scope === 'bot') {
    return (
      <>
        <Badge tone="slate" title={`${income.order_count} sale${income.order_count === 1 ? '' : 's'} closed without an operator`}>
          🤖 Bot: {money(income.total)} <span className="opacity-60">({income.order_count})</span>
        </Badge>
        <Badge tone="slate" onClick={() => onPick('')} title="Show everyone again">✕ clear</Badge>
      </>
    );
  }

  // The owner, filtered to one operator: what it earned, and what it costs.
  if (income.scope === 'operator') {
    return (
      <>
        <Badge tone="emerald" title={`${income.order_count} sale${income.order_count === 1 ? '' : 's'} credited to ${income.operator?.name}`}>
          💰 {income.operator?.name}: {money(income.total)}
          <span className="opacity-60">({income.order_count})</span>
        </Badge>
        {income.commission_configured ? (
          <Badge tone="violet" title="Commission owed on these sales, at the configured rates">
            🧾 Commission: {money(income.commission)}
          </Badge>
        ) : (
          <Badge tone="amber" title="No commission scheme has been set up yet, so nothing can be worked out">
            🧾 No commission scheme set
          </Badge>
        )}
        <Badge tone="slate" onClick={() => onPick('')} title="Show everyone again">✕ clear</Badge>
      </>
    );
  }

  // The owner, unfiltered: the whole month, split by who closed it.
  const ops = income.operators || [];
  return (
    <>
      <Badge tone="emerald" title={`${income.order_count} paid order${income.order_count === 1 ? '' : 's'} this month`}>
        💰 This month: {money(income.total)}
      </Badge>
      <Badge tone="slate" onClick={() => onPick('bot')}
             title={`${income.bot?.order_count || 0} sale(s) the bot closed with no operator involved`}>
        🤖 Bot: {money(income.bot?.total)}
      </Badge>
      {ops.map(o => (
        <Badge key={o.user_id} tone="violet" onClick={() => onPick(String(o.user_id))}
               title={`${o.order_count} sale(s)${income.commission_configured ? `, commission ${money(o.commission)}` : ''}`}>
          👤 {o.name}: {money(o.total)}
          {income.commission_configured && (
            <span className="opacity-70">· {money(o.commission)}</span>
          )}
        </Badge>
      ))}
      {/* Only worth a separate figure once there is more than one person in it. */}
      {ops.length > 1 && (
        <Badge tone="slate" title="All operators together">
          Σ Operators: {money(income.operator_total)}
          {income.commission_configured && <span className="opacity-70">· {money(income.commission_total)}</span>}
        </Badge>
      )}
    </>
  );
}
