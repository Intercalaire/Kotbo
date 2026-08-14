/**
 * Part d'un gain qui tient encore sous le plafond d'XP quotidien.
 *
 * `consumedTotal` est le compteur du jour *après* incrément : l'appelant
 * incrémente d'abord, puis demande ici ce qui était réellement accordable. Ce
 * sens de lecture est ce qui rend le plafond sûr face à deux gains concurrents,
 * là où un « je lis puis j'écris » laisserait les deux passer.
 */
export function grantedWithinDailyCap(consumedTotal: number, amount: number, cap: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return amount;
  const overflow = consumedTotal - cap;
  if (overflow <= 0) return amount;
  return Math.max(0, amount - overflow);
}
