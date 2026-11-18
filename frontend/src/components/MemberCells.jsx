// The member code and the member name of a loan, for the loan lists (requisition, approval, payment).
// A personal / business / product loan has one member; a group loan has one per member: the first three are listed, the rest are counted
// ("+4 more") with all of them in the tooltip.
const SHOWN = 3;

function MemberList({ members, field }) {
  const list = (members || []).filter((m) => m && (m.code || m.name));
  if (!list.length) return '—';
  const all = list.map((m) => `${m.code || ''} ${m.name || ''}`.trim()).join('\n');
  return (
    <span title={all}>
      {list.slice(0, SHOWN).map((m, i) => (
        <div key={`${m.code}-${i}`} style={field === 'code' ? { fontWeight: 600 } : undefined}>{(field === 'code' ? m.code : m.name) || '—'}</div>
      ))}
      {list.length > SHOWN && <div className="muted small">+{list.length - SHOWN} more</div>}
    </span>
  );
}

export const MemberCodeCell = ({ members }) => <td data-label="Member code"><MemberList members={members} field="code" /></td>;
export const MemberNameCell = ({ members }) => <td data-label="Member name"><MemberList members={members} field="name" /></td>;
