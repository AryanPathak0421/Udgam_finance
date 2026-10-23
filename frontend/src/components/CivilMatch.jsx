// Under a loan scheme that has "Civil required": the minimum score of the scheme, the civil score on the member's profile (actual civil check),
// and whether it matches. A scheme without it shows nothing.
export default function CivilMatch({ scheme, profile }) {
  if (!scheme?.civilRequired) return null;
  const min = scheme.minCivilScore;
  const profileScore = profile?.score ?? (typeof profile === 'number' ? profile : null);
  const meets = profileScore !== null && Number.isFinite(profileScore) && profileScore >= (min || 0);
  const tone = profileScore === null ? 'warn' : meets ? 'ok' : 'warn';
  return (
    <div className={`notice ${tone}`} style={{ marginTop: 6 }} role="status">
      <strong>Civil required:</strong> minimum score {min}
      {' · '}
      {profileScore !== null
        ? `Actual check score: ${profileScore}${profile?.bureau ? ` (${profile.bureau}${profile.reportDate ? `, ${profile.reportDate}` : ''})` : ''}`
        : 'No civil check on record'}
      {' · '}
      {profileScore === null ? 'complete Civil Check first under Civil Check' : meets ? `✓ ${profileScore} meets the minimum requirement` : `✗ ${profileScore} is below the required ${min}`}
    </div>
  );
}
