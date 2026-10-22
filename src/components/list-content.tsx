import type { ReactNode } from 'react';

/** An empty result is meaningful only after a successful load; existing rows remain usable during refresh. */
export function ListContent({loading,error,hasItems,onRetry,empty,children}:{loading:boolean;error:string;hasItems:boolean;onRetry:()=>void;empty:ReactNode;children:ReactNode}) {
  return <div aria-busy={loading}>
    {error && <p role="alert" className="finance-error">{error} <button type="button" className="row-action" disabled={loading} onClick={onRetry}>Coba lagi</button></p>}
    {hasItems?children:loading?<p role="status" className="finance-hint">Memuat riwayat…</p>:!error?<div className="finance-empty-inline">{empty}</div>:null}
  </div>;
}
