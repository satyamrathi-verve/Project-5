/*
  The Verve Advisory logo, loaded once and reused.

  Browsers can't hand jsPDF a URL, so we fetch /verve-logo.png, turn it into a
  data-URI, and read its natural size (to keep the aspect ratio when we place it
  on the page). Result is cached for the session.

  If the file isn't there yet, this returns null and every caller falls back to
  the drawn "verve / Advisory" wordmark — so nothing breaks.
*/

export const LOGO_SRC = "/verve-logo.png";

export interface LoadedLogo {
  dataUrl: string;
  width: number; // natural pixels
  height: number;
}

let cache: LoadedLogo | null | undefined; // undefined = not tried yet

export async function loadLogo(): Promise<LoadedLogo | null> {
  if (cache !== undefined) return cache;
  try {
    const res = await fetch(LOGO_SRC);
    if (!res.ok) throw new Error("logo not found");
    const blob = await res.blob();

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error("could not read logo"));
      fr.readAsDataURL(blob);
    });

    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("could not decode logo"));
      img.src = dataUrl;
    });

    cache = { dataUrl, ...size };
  } catch {
    cache = null; // fall back to the text wordmark
  }
  return cache;
}

/** Width that keeps the logo's aspect ratio at a given drawn height (PDF points). */
export function logoWidthFor(logo: LoadedLogo, height: number): number {
  return (logo.width / logo.height) * height;
}
