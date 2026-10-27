/** A branch as the lists show it: "IND — Indore Main" (code and name; whichever is there when only one is). */
export function branchLabel(b) {
  const code = b?.code || '';
  const name = b?.name || '';
  return code && name ? `${code} — ${name}` : code || name || '—';
}

/**
 * An employee as the lists show him: "EMP0007 — Name (BR01 — Indore)", the branch code and the branch name next to the employee.
 * It takes what the API sends: { code | employeeCode, name | employeeName, branchCode, branchName } or { branch: { code, name } }.
 */
export function staffLabel(e) {
  if (!e) return '';
  const code = e.code || e.employeeCode || '';
  const name = e.name || e.employeeName || '';
  const branchCode = e.branchCode || e.branch?.code || '';
  const branchName = e.branchName || e.branch?.name || '';
  const branch = branchCode ? ` (${branchCode}${branchName ? ` — ${branchName}` : ''})` : '';
  return `${code}${name ? ` — ${name}` : ''}${branch}`;
}
