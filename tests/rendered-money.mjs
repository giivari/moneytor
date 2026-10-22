/** Normalize only grouping markup for existing exact-money SSR assertions.
 * New amount tests inspect the raw token/wrap DOM separately. */
export function readableMoneyMarkup(output) {
  return output.replace(/<span class="financial-amount-group">([^<]*)<\/span>/g, '$1').replace(/<wbr\s*\/?>/g, '');
}
