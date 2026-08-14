const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// Accepts a bare 11-char video ID or any common YouTube URL shape
// (watch?v=, youtu.be/, embed/, shorts/, music.youtube.com) and returns
// just the ID — that's all the frontend needs to build both the official
// thumbnail CDN URL and the embed player URL. Returns null if it doesn't
// look like YouTube at all, so callers can reject bad input up front.
export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id && VIDEO_ID_PATTERN.test(id) ? id : null;
    }
    const match = /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (match) return match[1];
  }

  return null;
}
