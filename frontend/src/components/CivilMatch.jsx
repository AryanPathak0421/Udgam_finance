// Under a loan scheme that has "Civil required": the minimum score of the scheme, the civil score on the member's profile (newest civil check),
// and whether it matches. A scheme without it shows nothing.
export default function CivilMatch({ scheme, profile, typed }) {
  if (!scheme?.civilRequired) return null;
  const min = scheme.minCivilScore;
  const profileScore = profile?.score ?? (typeof profile === 'number' ? profile : null);
  const score = typed !== undefined && typed !== null && String(typed).trim() !== '' ? Number(typed) : profileScore;
  const meets = score !== null && Number.isFinite(score) && score >= (min || 0);
  const tone = score === null ? 'warn' : meets ? 'ok' : 'warn';
  return (
    <div className={`notice ${tone}`} style={{ marginTop: 6 }} role="status">
      <strong>Civil required:</strong> minimum score {min}
      {' · '}
      {profileScore !== null
        ? `Profile civil score ${profileScore}${profile?.bureau ? ` (${profile.bureau}${profile.reportDate ? `, ${profile.reportDate}` : ''})` : ''}`
        : 'No civil check on the profile'}
      {' · '}
      {score === null ? 'enter the score or do the civil check first' : meets ? `✓ ${score} meets the minimum` : `✗ ${score} is below the minimum`}
    </div>
  );
}
