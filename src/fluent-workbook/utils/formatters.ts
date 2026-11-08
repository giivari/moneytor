export function formatIDR(
  amount: number,
  hideRp: boolean = false,
  options?: { showPlus?: boolean; showMinus?: boolean }
): string {
  if (hideRp) {
    if (options?.showPlus && amount > 0) return '+Rp ••••••••';
    if (options?.showMinus && amount < 0) return '-Rp ••••••••';
    return 'Rp ••••••••';
  }

  const absVal = Math.abs(Math.round(amount));
  const formattedNumber = absVal.toLocaleString('id-ID');

  if (amount > 0 && options?.showPlus) {
    return `+Rp ${formattedNumber}`;
  }
  if (amount < 0 || options?.showMinus) {
    return `-Rp ${formattedNumber}`;
  }
  return `Rp ${formattedNumber}`;
}

export function formatSignedIDR(amount: number, hideRp: boolean = false): string {
  if (hideRp) {
    return amount >= 0 ? '+Rp ••••••••' : '-Rp ••••••••';
  }
  const absVal = Math.abs(Math.round(amount)).toLocaleString('id-ID');
  if (amount > 0) return `+Rp ${absVal}`;
  if (amount < 0) return `-Rp ${absVal}`;
  return `Rp 0`;
}

export function formatPercent(val: number, showPlus = true): string {
  const fixed = Math.abs(val).toFixed(2).replace('.', ',');
  if (val > 0 && showPlus) return `+${fixed}%`;
  if (val < 0) return `-${fixed}%`;
  return `${fixed}%`;
}
