import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Kind = 'bill' | 'report';
type Settings = { paper: string; width: number; height: number; orientation: 'portrait' | 'landscape' };
type PrintRequest = { kind: Kind; title: string; element?: Element | null; lines?: string[] };
const defaults = (kind: Kind): Settings => ({ paper: kind === 'bill' ? '80' : 'A4', width: kind === 'bill' ? 80 : 210, height: 297, orientation: 'portrait' });
const key = (kind: Kind) => `fmcg.print.${kind}.v1`;
const validDimension = (value: number) => Number.isFinite(value) && value >= 30 && value <= 2000;

export function readPrintSettings(kind: Kind): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(key(kind)) || 'null');
    const papers = kind === 'bill' ? ['58', '76', '80', 'custom'] : ['A4', 'A5', 'Letter', 'custom'];
    if (value && papers.includes(value.paper) && validDimension(value.width) && validDimension(value.height) && ['portrait', 'landscape'].includes(value.orientation)) return value;
  } catch { /* Storage is optional; printing still works in restricted browsers. */ }
  return defaults(kind);
}

export function savePrintSettings(kind: Kind, settings: Settings) {
  try { localStorage.setItem(key(kind), JSON.stringify(settings)); } catch { /* Keep printing available. */ }
}

// Both independently built applications use this print-only module.
export async function printDocument(request: PrintRequest, settings: Settings) {
  const frame = document.createElement('iframe');
  frame.title = request.title;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;border:0;height:1000px;';
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    doc.title = request.title;
    const dimensions: Record<string, [number, number]> = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };
    let [width, height] = dimensions[settings.paper] || [settings.width, settings.height];
    if (request.kind === 'bill') width = settings.paper === 'custom' ? settings.width : Number(settings.paper);
    else if (settings.orientation === 'landscape') [width, height] = [Math.max(width, height), Math.min(width, height)];
    else [width, height] = [Math.min(width, height), Math.max(width, height)];
    frame.style.width = `${width}mm`;
    const sheets = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(node => {
      const copy = node.cloneNode(true) as HTMLElement;
      const ready = copy.tagName === 'LINK' ? new Promise<void>((resolve, reject) => {
        copy.onload = () => resolve();
        copy.onerror = () => reject(new Error('Could not load print styles. Please try again.'));
      }) : Promise.resolve();
      doc.head.appendChild(copy);
      return ready;
    });
    const content = request.lines ? doc.createElement('pre') : request.element?.cloneNode(true) as HTMLElement | undefined;
    if (!content) throw new Error('The document is no longer available. Please reopen it.');
    if (request.lines) content.textContent = request.lines.join('\n');
    // Remove controls only from the print copy, keeping sortable column headings.
    content.querySelectorAll('button').forEach(button => {
      if (button.closest('th')) button.replaceWith(...Array.from(button.childNodes));
      else button.remove();
    });
    content.querySelectorAll('[role="alert"], [data-print-omit]').forEach(node => node.remove());
    content.removeAttribute('id');
    content.setAttribute('data-print-document', request.kind);
    doc.body.appendChild(content);
    const style = doc.createElement('style');
    const css = `
      html, body { margin:0 !important; padding:0 !important; background:white !important; color:black; min-height:0 !important; }
      [data-print-document] { display:block !important; width:100% !important; max-width:none !important; margin:0 !important; padding:0 !important; box-shadow:none !important; }
      [data-print-document] * { box-shadow:none !important; }
      [data-print-document] table { width:100% !important; min-width:0 !important; table-layout:fixed; }
      [data-print-document] th, [data-print-document] td { position:static !important; white-space:normal !important; overflow-wrap:anywhere; }
      [data-print-document] thead { display:table-header-group; }
      [data-print-document] tfoot { display:table-row-group; }
      [data-print-document] tr { break-inside:avoid; }
      [data-print-document] [class*="overflow"] { overflow:visible !important; max-height:none !important; }
      [data-print-document] [class*="whitespace-nowrap"] { white-space:normal !important; }
      [data-print-document] .flex { flex-wrap:wrap; }
      [data-print-document="bill"] { padding:1mm !important; overflow-wrap:anywhere; }
      [data-print-document="report"] th, [data-print-document="report"] td { padding:2mm !important; }
      [data-print-document="report"] { overflow-wrap:anywhere; }
      pre[data-print-document] { white-space:pre-wrap; font:12px/1.5 monospace; }
      [data-print-day-page] { display:block !important; padding:0 !important; }
      [data-print-day-thermal] { display:none !important; }
      @media screen { body { width:${request.kind === 'bill' ? width : width - 20}mm; } }
    `;
    style.textContent = css;
    doc.head.appendChild(style);
    await Promise.all(sheets);
    await doc.fonts.ready;
    await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
    if (request.kind === 'bill') height = Math.ceil(content.getBoundingClientRect().height * 25.4 / 96) + 2;
    const pageSize = request.kind === 'report' && settings.paper !== 'custom' ? `${settings.paper} ${settings.orientation}` : `${width}mm ${height}mm`;
    style.textContent = `${css}\n@page { size:${pageSize}; margin:${request.kind === 'bill' ? '0' : '10mm'}; }`;
    // Keep the frame alive until the native dialog closes (including cancellation).
    win.addEventListener('afterprint', () => frame.remove(), { once: true });
    win.focus();
    win.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}

function PrintDialog({ request, close }: { request: PrintRequest; close: () => void }) {
  const [settings, setSettings] = useState(() => readPrintSettings(request.kind));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const inputClass = 'w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2';
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) close(); }} className="rounded-lg p-4 w-full max-w-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 backdrop:bg-black/40">
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      setBusy(true); setError('');
      try { savePrintSettings(request.kind, settings); await printDocument(request, settings); close(); }
      catch (e) { setError(e instanceof Error ? e.message : 'Printing failed. Please try again.'); setBusy(false); }
    }}>
      <h2 className="font-bold text-lg">Print settings</h2>
      <label className="block">{request.kind === 'bill' ? 'Paper width' : 'Paper size'}
        <select autoFocus className={inputClass} value={settings.paper} onChange={e => setSettings({ ...settings, paper: e.target.value })}>
          {(request.kind === 'bill' ? ['58', '76', '80', 'custom'] : ['A4', 'A5', 'Letter', 'custom']).map(paper => <option key={paper} value={paper}>{paper === 'custom' ? 'Custom' : request.kind === 'bill' ? `${paper} mm` : paper}</option>)}
        </select>
      </label>
      {settings.paper === 'custom' && <>
        <label className="block">Width (mm)<input required type="number" min="30" max="2000" step="0.1" className={inputClass} value={settings.width} onChange={e => setSettings({ ...settings, width: Number(e.target.value) })} /></label>
        {request.kind === 'report' && <label className="block">Height (mm)<input required type="number" min="30" max="2000" step="0.1" className={inputClass} value={settings.height} onChange={e => setSettings({ ...settings, height: Number(e.target.value) })} /></label>}
      </>}
      {request.kind === 'report' && <label className="block">Orientation<select className={inputClass} value={settings.orientation} onChange={e => setSettings({ ...settings, orientation: e.target.value as Settings['orientation'] })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={close} className="rounded bg-gray-200 dark:bg-gray-700 px-3 py-2 font-bold">Cancel</button>
        <button disabled={busy} className="rounded bg-blue-600 text-white px-3 py-2 font-bold">Print / Save as PDF</button>
      </div>
    </form>
  </dialog>;
}

export function openPrintDialog(request: PrintRequest) {
  const previousFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); previousFocus?.focus(); };
  root.render(<PrintDialog request={request} close={close} />);
}
