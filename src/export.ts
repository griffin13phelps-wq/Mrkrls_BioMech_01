/**
 * Getting the CSV off the phone. iPhone Safari supports <a download> for blob
 * URLs (it shows a download prompt). Home-screen (standalone) web apps on iOS
 * have historically handled blob downloads poorly, so there the share sheet
 * is used first. A "Share" button is always offered as the fallback.
 */

export function csvFileName(sessionId: string): string {
  return `mocap_${sessionId}.csv`;
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function makeCsvFile(csv: string, name: string): File {
  return new File([csv], name, { type: 'text/csv;charset=utf-8' });
}

/** Trigger a direct download. Returns false if this browser cannot do it. */
export function downloadFile(file: File): boolean {
  const a = document.createElement('a');
  if (!('download' in a)) return false;
  const url = URL.createObjectURL(file);
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  try {
    a.click();
  } catch {
    a.remove();
    URL.revokeObjectURL(url);
    return false;
  }
  a.remove();
  // Give Safari time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export async function shareFile(file: File): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFile(file)) return 'unsupported';
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (e) {
    return (e as DOMException)?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/** Export: share sheet first in standalone mode, else direct download, else share sheet. */
export async function exportCsv(file: File): Promise<'downloaded' | 'shared' | 'cancelled' | 'failed'> {
  if (isStandalone() && canShareFile(file)) {
    const r = await shareFile(file);
    if (r !== 'unsupported') return r;
  }
  if (downloadFile(file)) return 'downloaded';
  const r = await shareFile(file);
  return r === 'unsupported' ? 'failed' : r;
}
